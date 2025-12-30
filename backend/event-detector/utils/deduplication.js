import crypto from 'crypto';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';

function generateEventId(url, timestamp) {
  const hash = crypto.createHash('sha256');
  hash.update(url + timestamp);
  return hash.digest('hex').substring(0, 16);
}

async function eventExists(dynamoDB, eventId) {
  try {
    const result = await dynamoDB.send(new GetItemCommand({
      TableName: 'portfolio-events',
      Key: {
        event_id: { S: eventId }
      }
    }));
    
    return !!result.Item;
  } catch (error) {
    console.error('Error checking event existence:', error);
    return false;
  }
}

export { generateEventId, eventExists };