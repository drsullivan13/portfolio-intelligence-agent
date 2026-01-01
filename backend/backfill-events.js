import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

export async function backfillEvents() {
  console.log('🔍 Scanning for PENDING_ANALYSIS events...\n');
  
  try {
    // Scan for all pending events
    const result = await docClient.send(new ScanCommand({
      TableName: 'portfolio-events',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'PENDING_ANALYSIS'
      }
    }));
    
    const pendingEvents = result.Items || [];
    console.log(`Found ${pendingEvents.length} events to process\n`);
    
    if (pendingEvents.length === 0) {
      console.log('✅ No events to process!');
      return;
    }
    
    // Publish each event to SNS
    let processed = 0;
    let failed = 0;
    
    for (const event of pendingEvents) {
      try {
        console.log(`Publishing: ${event.ticker} - ${event.headline.substring(0, 50)}...`);
        
        // Reconstruct SNS message format
        const message = {
          eventId: event.event_id,
          eventType: event.event_type,
          ticker: event.ticker,
          headline: event.headline,
          url: event.url,
          timestamp: event.timestamp,
          ...(event.sentiment_score && { sentiment: parseFloat(event.sentiment_score) }),
          ...(event.summary && { summary: event.summary })
        };
        
        await snsClient.send(new PublishCommand({
          TopicArn: SNS_TOPIC_ARN,
          Message: JSON.stringify(message),
          Subject: `Backfill: ${event.event_type} Event - ${event.ticker}`
        }));
        
        processed++;
        
        // Rate limit: wait 100ms between publishes to avoid overwhelming Lambda
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Failed to publish ${event.event_id}:`, error.message);
        failed++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`✅ Backfill complete!`);
    console.log(`   Published: ${processed}`);
    console.log(`   Failed: ${failed}`);
    console.log('='.repeat(60));
    console.log('\nEvents are now being processed by your Lambda.');
    console.log('Check CloudWatch logs to monitor progress:');
    console.log('aws logs tail /aws/lambda/event-processor --follow');
    
  } catch (error) {
    console.error('Error during backfill:', error);
  }
}

backfillEvents();