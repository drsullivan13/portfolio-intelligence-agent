import { DynamoDBClient, QueryCommand, GetItemCommand, PutItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const { AWS_REGION, SNS_TOPIC_ARN } = process.env;
const dynamoDB = new DynamoDBClient({ region: AWS_REGION });
const sns = new SNSClient({ region: AWS_REGION });

const TABLE_EVENTS = 'portfolio-events';
const TABLE_USER_EVENTS = 'user-events';
const GSI_TICKER_TIMESTAMP = 'ticker-timestamp-index';

/**
 * Main Lambda handler
 * Triggered when user adds tickers to their watchlist
 */
export const handler = async (event) => {
  console.log('=== Event Detector Backfill Lambda Started ===');
  console.log('Event:', JSON.stringify(event, null, 2));

  try {
    // Parse payload
    const payload = typeof event === 'string' ? JSON.parse(event) : event;
    const { userId, addedTickers } = payload;

    if (!userId) {
      throw new Error('userId is required');
    }

    if (!addedTickers || !Array.isArray(addedTickers) || addedTickers.length === 0) {
      console.log('No tickers added, skipping backfill');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No tickers to process', backfilled: 0, detected: 0 })
      };
    }

    console.log(`Processing ${addedTickers.length} added tickers for user: ${userId}`);
    console.log(`Tickers: ${addedTickers.join(', ')}`);

    // Step 1: Categorize tickers into existing (have events) vs new (no events)
    const { existingTickers, newTickers } = await categorizeTickers(addedTickers);

    console.log(`\nCategorization results:`);
    console.log(`- Existing tickers (backfill): ${existingTickers.length} - ${existingTickers.join(', ') || 'none'}`);
    console.log(`- New tickers (detect): ${newTickers.length} - ${newTickers.join(', ') || 'none'}`);

    let backfilledCount = 0;
    let detectedCount = 0;

    // Step 2: Backfill existing events
    if (existingTickers.length > 0) {
      backfilledCount = await backfillExistingEvents(userId, existingTickers);
    }

    // Step 3: Detect and process new tickers
    if (newTickers.length > 0) {
      detectedCount = await detectNewTickerEvents(userId, newTickers);
    }

    console.log(`\n=== Backfill Complete ===`);
    console.log(`Backfilled: ${backfilledCount} events`);
    console.log(`Detected: ${detectedCount} new events`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Backfill complete',
        backfilled: backfilledCount,
        detected: detectedCount,
        existingTickers,
        newTickers
      })
    };
  } catch (error) {
    console.error('Error in backfill handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Categorizes tickers into those with existing events vs those without
 */
async function categorizeTickers(tickers) {
  const existingTickers = [];
  const newTickers = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  for (const ticker of tickers) {
    const hasEvents = await tickerHasRecentEvents(ticker, thirtyDaysAgo);
    if (hasEvents) {
      existingTickers.push(ticker);
    } else {
      newTickers.push(ticker);
    }
  }

  return { existingTickers, newTickers };
}

/**
 * Checks if a ticker has any events in the last 30 days
 */
async function tickerHasRecentEvents(ticker, startDate) {
  try {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_EVENTS,
      IndexName: GSI_TICKER_TIMESTAMP,
      KeyConditionExpression: 'ticker = :ticker AND #ts >= :startDate',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':ticker': { S: ticker },
        ':startDate': { S: startDate.toISOString() }
      },
      Limit: 1 // We just need to know if any events exist
    }));

    return result.Items && result.Items.length > 0;
  } catch (error) {
    console.error(`Error checking events for ${ticker}:`, error);
    return false;
  }
}

/**
 * Backfills existing events for tickers that already have events
 * Creates user-event relationships without republishing to SNS
 */
async function backfillExistingEvents(userId, tickers) {
  console.log(`\n--- BACKFILLING EXISTING EVENTS ---`);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let totalBackfilled = 0;

  for (const ticker of tickers) {
    console.log(`\nBackfilling ${ticker}...`);

    // Query all events for this ticker in last 30 days
    const events = await queryEventsByTickerAndDate(ticker, thirtyDaysAgo);

    if (events.length === 0) {
      console.log(`No events found for ${ticker}`);
      continue;
    }

    console.log(`Found ${events.length} events for ${ticker}`);

    // Create user-event relationships
    // Note: AI analysis is already attached to events from previous processing
    // No need to republish to SNS - user will see existing analysis
    await createUserEventRelationships(userId, events);

    totalBackfilled += events.length;
  }

  console.log(`\nTotal backfilled: ${totalBackfilled} events`);
  return totalBackfilled;
}

/**
 * Queries events by ticker and date range using GSI
 */
async function queryEventsByTickerAndDate(ticker, startDate) {
  const events = [];
  let lastEvaluatedKey = undefined;

  do {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_EVENTS,
      IndexName: GSI_TICKER_TIMESTAMP,
      KeyConditionExpression: 'ticker = :ticker AND #ts >= :startDate',
      ExpressionAttributeNames: { '#ts': 'timestamp' },
      ExpressionAttributeValues: {
        ':ticker': { S: ticker },
        ':startDate': { S: startDate.toISOString() }
      },
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    }));

    events.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return events;
}

/**
 * Creates user-event relationships in batches
 */
async function createUserEventRelationships(userId, events) {
  if (events.length === 0) return;

  const ttl = Math.floor(Date.now() / 1000 + 30 * 24 * 60 * 60); // 30 days TTL
  const batches = chunkArray(events, 25); // DynamoDB batch limit

  console.log(`Creating ${events.length} user-event relationships in ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const putRequests = batch.map(event => ({
      PutRequest: {
        Item: {
          user_id: { S: userId },
          event_id: { S: event.event_id.S },
          ticker: { S: event.ticker.S },
          timestamp: { S: event.timestamp.S },
          ttl: { N: ttl.toString() }
        }
      }
    }));

    try {
      await dynamoDB.send(new BatchWriteItemCommand({
        RequestItems: {
          [TABLE_USER_EVENTS]: putRequests
        }
      }));

      console.log(`Batch ${i + 1}/${batches.length} complete (${batch.length} relationships)`);
    } catch (error) {
      console.error(`Error writing batch ${i + 1}:`, error);
      // Continue with other batches
    }
  }

  console.log(`Successfully created ${events.length} user-event relationships`);
}

/**
 * Detects and processes events for new tickers that don't have existing events
 * Runs SEC Edgar detection and publishes to SNS for AI analysis
 */
async function detectNewTickerEvents(userId, tickers) {
  console.log(`\n--- DETECTING NEW TICKER EVENTS ---`);

  // Import SEC Edgar detector
  const { getSECFilings } = await import('./sources/secEdgar.js');

  let totalDetected = 0;

  for (const ticker of tickers) {
    console.log(`\nDetecting SEC filings for ${ticker}...`);

    try {
      // Run SEC Edgar detection (30-day lookback built into getSECFilings)
      const filings = await getSECFilings([ticker]);

      console.log(`Found ${filings.length} SEC filings for ${ticker}`);

      for (const filing of filings) {
        const eventId = filing.accessionNumber;

        // Check if event already exists (unlikely but safe)
        const exists = await eventExists(eventId);
        if (exists) {
          console.log(`Event ${eventId} already exists, skipping`);
          continue;
        }

        // Store event in portfolio-events
        await storeNewEvent(filing);

        // Create user-event relationship for this user
        await createSingleUserEventRelationship(userId, eventId, {
          ticker: filing.ticker,
          timestamp: filing.filingDate
        });

        // Publish to SNS for AI analysis
        await publishEventToSNS(userId, filing, eventId);

        totalDetected++;
      }
    } catch (error) {
      console.error(`Error detecting events for ${ticker}:`, error);
      // Continue with other tickers
    }
  }

  console.log(`\nTotal detected: ${totalDetected} new events`);
  return totalDetected;
}

/**
 * Checks if an event exists in portfolio-events table
 */
async function eventExists(eventId) {
  try {
    const result = await dynamoDB.send(new GetItemCommand({
      TableName: TABLE_EVENTS,
      Key: {
        event_id: { S: eventId }
      }
    }));

    return !!result.Item;
  } catch (error) {
    console.error(`Error checking event existence for ${eventId}:`, error);
    return false;
  }
}

/**
 * Stores a new event in portfolio-events table
 */
async function storeNewEvent(filing) {
  await dynamoDB.send(new PutItemCommand({
    TableName: TABLE_EVENTS,
    Item: {
      event_id: { S: filing.accessionNumber },
      ticker: { S: filing.ticker },
      event_type: { S: 'SEC_FILING' },
      timestamp: { S: filing.filingDate },
      headline: { S: filing.headline || `8-K Filing: ${filing.formType}` },
      url: { S: filing.url },
      watcher_count: { N: '1' },
      detected_at: { S: new Date().toISOString() },
      status: { S: 'PENDING_ANALYSIS' },
      ...(filing.items && { items_reported: { S: filing.items.join(', ') } }),
      ...(filing.primaryItem && { primary_item: { S: filing.primaryItem } }),
      ...(filing.summary && { content_summary: { S: filing.summary } })
    },
    ConditionExpression: 'attribute_not_exists(event_id)'
  }));

  console.log(`Stored event ${filing.accessionNumber} for ${filing.ticker}`);
}

/**
 * Creates a single user-event relationship
 */
async function createSingleUserEventRelationship(userId, eventId, eventData) {
  const ttl = Math.floor(Date.now() / 1000 + 30 * 24 * 60 * 60);

  await dynamoDB.send(new PutItemCommand({
    TableName: TABLE_USER_EVENTS,
    Item: {
      user_id: { S: userId },
      event_id: { S: eventId },
      ticker: { S: eventData.ticker },
      timestamp: { S: eventData.timestamp },
      ttl: { N: ttl.toString() }
    }
  }));

  console.log(`Created user-event relationship: ${userId} -> ${eventId}`);
}

/**
 * Publishes event to SNS for AI analysis
 */
async function publishEventToSNS(userId, filing, eventId) {
  const message = {
    eventId,
    eventType: 'SEC_FILING',
    userIds: [userId],
    ticker: filing.ticker,
    formType: filing.formType,
    filingDate: filing.filingDate,
    url: filing.url,
    timestamp: filing.filingDate,
    headline: filing.headline || `8-K Filing: ${filing.formType}`,
    summary: filing.summary || '',
    items: filing.items || [],
    primaryItem: filing.primaryItem || ''
  };

  await sns.send(new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Message: JSON.stringify(message),
    Subject: `New SEC_FILING Event: ${filing.ticker}`
  }));

  console.log(`Published event ${eventId} to SNS`);
}

/**
 * Utility: Chunks array into smaller arrays
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
