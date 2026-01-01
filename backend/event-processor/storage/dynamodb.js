import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function updateDynamoDB(eventId, analysis, similarEventsCount) {
  try {
    console.log(`Updating DynamoDB for event ${eventId}...`);
    
    const command = new UpdateCommand({
      TableName: 'portfolio-events',
      Key: { event_id: eventId },
      UpdateExpression: `SET
        analysis = :analysis,
        #status = :status,
        analyzed_at = :analyzed_at,
        processing_metadata = :metadata,
        #ttl = :ttl`,
      ExpressionAttributeNames: {
        '#status': 'status',
        '#ttl': 'ttl'
      },
      ExpressionAttributeValues: {
        ':analysis': analysis,
        ':status': 'ANALYZED',
        ':analyzed_at': new Date().toISOString(),
        ':metadata': {
          similar_events_count: similarEventsCount,
          model_version: 'claude-sonnet-4-5-20250929'
        },
        ':ttl': Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days
      }
    });
    
    await docClient.send(command);
    console.log('✅ DynamoDB updated');
  } catch (error) {
    console.error('Error updating DynamoDB:', error.message);
    throw error;
  }
}

export { updateDynamoDB };