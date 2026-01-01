import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { getAlphaVantageNews } from './sources/alphaVantage.js';
import { getSECFilings } from './sources/secEdgar.js';
import { generateEventId, eventExists } from './utils/deduplication.js';
import { publishToSNS } from './utils/snsPublisher.js';

const { AWS_REGION, WATCHLIST: watchlistEnv } = process.env;
const dynamoDB = new DynamoDBClient({ region: AWS_REGION });
const sns = new SNSClient({ region: AWS_REGION });

const WATCHLIST = JSON.parse(watchlistEnv || '["TSLA","NVDA","AAPL","MSFT","GOOGL"]');

export const handler = async (_event) => {
  console.log('Event Detector started');
  console.log('Watchlist:', WATCHLIST);
  
  const newEvents = [];
  
  try {
    // 1. Check Alpha Vantage News
    console.log('Checking Alpha Vantage for news...');
    const newsEvents = await getAlphaVantageNews(WATCHLIST);
    console.log(`Alpha Vantage returned ${newsEvents.length} articles`);
    
    for (const newsEvent of newsEvents) {
      const eventId = generateEventId(newsEvent.url, newsEvent.time_published);
      
      const exists = await eventExists(dynamoDB, eventId);
      
      if (!exists) {
        console.log(`New news event found: ${eventId}`);
        
        // Store in DynamoDB to mark as seen
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
            detected_at: { S: new Date().toISOString() },
            status: { S: 'PENDING_ANALYSIS' }
          }
        }));
        
        // Publish to SNS for processing
        await publishToSNS(sns, {
          eventId,
          eventType: 'NEWS',
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
    const filingEvents = await getSECFilings(WATCHLIST);
    
    for (const filing of filingEvents) {
      const eventId = filing.accessionNumber;
      
      const exists = await eventExists(dynamoDB, eventId);
      
      if (!exists) {
        console.log(`New SEC filing found: ${eventId}`);
        
        await dynamoDB.send(new PutItemCommand({
          TableName: 'portfolio-events',
          Item: {
            event_id: { S: eventId },
            ticker: { S: filing.ticker },
            event_type: { S: 'SEC_FILING' },
            timestamp: { S: filing.filingDate },
            headline: { S: filing.headline || `8-K Filing: ${filing.formType}` },
            url: { S: filing.url },
            detected_at: { S: new Date().toISOString() },
            status: { S: 'PENDING_ANALYSIS' },
            ...(filing.items && { items_reported: { S: filing.items.join(', ') } }),
            ...(filing.primaryItem && { primary_item: { S: filing.primaryItem } }),
            ...(filing.summary && { content_summary: { S: filing.summary } })
          }
        }));
        
        await publishToSNS(sns, {
          eventId,
          eventType: 'SEC_FILING',
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