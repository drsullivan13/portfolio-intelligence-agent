import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { getAlphaVantageNews } from './sources/alphaVantage.js';
import { getSECFilings } from './sources/secEdgar.js';
import { generateEventId, eventExists } from './utils/deduplication.js';
import { publishToSNS } from './utils/snsPublisher.js';
import { loadAllWatchlists } from './utils/watchlists.js';
import { aggregateTickersFromWatchlists } from './utils/tickerAggregator.js';
import { createUserEventRelationships } from './utils/userEventRelationships.js';

const { AWS_REGION, WATCHLIST: watchlistEnv } = process.env;
const dynamoDB = new DynamoDBClient({ region: AWS_REGION });
const sns = new SNSClient({ region: AWS_REGION });

export const handler = async (_event) => {
  console.log('Event Detector started');

  const newEvents = [];

  try {
    // Load user watchlists from DynamoDB
    let userWatchlists = await loadAllWatchlists();

    // Fallback to environment variable if no watchlists found
    if (userWatchlists.size === 0) {
      console.log('No watchlists found in DynamoDB, using fallback from environment variable');
      const fallbackWatchlist = JSON.parse(watchlistEnv || '["TSLA","NVDA","AAPL","MSFT","GOOGL"]');
      userWatchlists.set('admin-001', fallbackWatchlist);
    }

    console.log(`Processing events for ${userWatchlists.size} user(s)`);

    // Aggregate tickers across all users to process each ticker only once
    const tickerToUsers = aggregateTickersFromWatchlists(userWatchlists);
    console.log(`\n=== Processing ${tickerToUsers.size} unique tickers ===`);

    // Process each ticker ONCE, regardless of how many users watch it
    for (const [ticker, userIds] of tickerToUsers) {
      console.log(`\nProcessing ${ticker} for ${userIds.size} user(s): ${Array.from(userIds).join(', ')}`);

      // 1. Check Alpha Vantage News
      console.log('Checking Alpha Vantage for news...');
      const newsEvents = await getAlphaVantageNews([ticker]);
      console.log(`Alpha Vantage returned ${newsEvents.length} articles for ${ticker}`);

      for (const newsEvent of newsEvents) {
        const eventId = generateEventId(newsEvent.url, newsEvent.time_published);

        const exists = await eventExists(dynamoDB, eventId);

        if (!exists) {
          console.log(`New news event found: ${eventId} (${userIds.size} watchers)`);

          // Store event ONCE in portfolio-events (no user_id, add watcher_count)
          await dynamoDB.send(new PutItemCommand({
            TableName: 'portfolio-events',
            Item: {
              event_id: { S: eventId },
              ticker: { S: newsEvent.ticker },
              event_type: { S: 'NEWS' },
              timestamp: { S: newsEvent.time_published },
              headline: { S: newsEvent.title },
              url: { S: newsEvent.url },
              sentiment_score: { N: newsEvent.sentiment.toString() },
              watcher_count: { N: userIds.size.toString() },
              detected_at: { S: new Date().toISOString() },
              status: { S: 'PENDING_ANALYSIS' }
            },
            ConditionExpression: 'attribute_not_exists(event_id)'
          }));

          // Create user-event relationships for ALL watchers
          await createUserEventRelationships(dynamoDB, eventId, userIds, {
            ticker: newsEvent.ticker,
            timestamp: newsEvent.time_published
          });

          // Publish to SNS ONCE with array of all watching users
          await publishToSNS(sns, {
            eventId,
            eventType: 'NEWS',
            userIds: Array.from(userIds),
            ticker: newsEvent.ticker,
            headline: newsEvent.title,
            url: newsEvent.url,
            sentiment: newsEvent.sentiment,
            timestamp: newsEvent.time_published,
            summary: newsEvent.summary
          });

          newEvents.push(eventId);
        }
      }

      // 2. Check SEC EDGAR Filings
      console.log('Checking SEC EDGAR for 8-K filings...');
      const filingEvents = await getSECFilings([ticker]);
      console.log(`SEC EDGAR returned ${filingEvents.length} filings for ${ticker}`);

      for (const filing of filingEvents) {
        const eventId = filing.accessionNumber;

        const exists = await eventExists(dynamoDB, eventId);

        if (!exists) {
          console.log(`New SEC filing found: ${eventId} (${userIds.size} watchers)`);

          // Store event ONCE in portfolio-events (no user_id, add watcher_count)
          await dynamoDB.send(new PutItemCommand({
            TableName: 'portfolio-events',
            Item: {
              event_id: { S: eventId },
              ticker: { S: filing.ticker },
              event_type: { S: 'SEC_FILING' },
              timestamp: { S: filing.filingDate },
              headline: { S: filing.headline || `8-K Filing: ${filing.formType}` },
              url: { S: filing.url },
              watcher_count: { N: userIds.size.toString() },
              detected_at: { S: new Date().toISOString() },
              status: { S: 'PENDING_ANALYSIS' },
              ...(filing.items && { items_reported: { S: filing.items.join(', ') } }),
              ...(filing.primaryItem && { primary_item: { S: filing.primaryItem } }),
              ...(filing.summary && { content_summary: { S: filing.summary } })
            },
            ConditionExpression: 'attribute_not_exists(event_id)'
          }));

          // Create user-event relationships for ALL watchers
          await createUserEventRelationships(dynamoDB, eventId, userIds, {
            ticker: filing.ticker,
            timestamp: filing.filingDate
          });

          // Publish to SNS ONCE with array of all watching users
          await publishToSNS(sns, {
            eventId,
            eventType: 'SEC_FILING',
            userIds: Array.from(userIds),
            ticker: filing.ticker,
            formType: filing.formType,
            filingDate: filing.filingDate,
            url: filing.url,
            timestamp: filing.filingDate,
            headline: filing.headline || `8-K Filing: ${filing.formType}`,
            summary: filing.summary || '',
            items: filing.items || [],
            primaryItem: filing.primaryItem || ''
          });

          newEvents.push(eventId);
        }
      }
    }
    
    console.log(`Detection complete. Found ${newEvents.length} new events.`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Detected ${newEvents.length} new events`,
        events: newEvents
      })
    };
    
  } catch (error) {
    console.error('Error in event detection:', error);
    throw error;
  }
};