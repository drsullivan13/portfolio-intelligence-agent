/**
 * User-Event Relationships Utility
 *
 * Manages the junction table relationships between users and events.
 * This allows multiple users to watch the same event without duplicating
 * the event data or AI analysis.
 */

import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';

/**
 * Chunks an array into smaller arrays of specified size
 *
 * @param {Array} array - The array to chunk
 * @param {number} size - The size of each chunk
 * @returns {Array[]} Array of chunks
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Creates user-event relationships in the junction table
 *
 * @param {DynamoDBClient} dynamoDB - DynamoDB client instance
 * @param {string} eventId - The event ID
 * @param {Set<string>} userIds - Set of user IDs watching this event
 * @param {Object} eventData - Event data containing ticker, timestamp, etc.
 * @param {string} eventData.ticker - Stock ticker symbol
 * @param {string} eventData.timestamp - ISO 8601 timestamp
 *
 * Uses batch write for efficiency (max 25 items per batch as per DynamoDB limits)
 */
async function createUserEventRelationships(dynamoDB, eventId, userIds, eventData) {
  const userIdArray = Array.from(userIds);

  if (userIdArray.length === 0) {
    console.log(`[UserEventRelationships] No users to create relationships for event ${eventId}`);
    return;
  }

  // Calculate TTL: 30 days from now (matches event TTL)
  const ttl = Math.floor(Date.now() / 1000 + 30 * 24 * 60 * 60);

  // Batch writes in groups of 25 (DynamoDB limit)
  const batches = chunkArray(userIdArray, 25);

  console.log(`[UserEventRelationships] Creating ${userIdArray.length} user-event relationships for ${eventId} in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const putRequests = batch.map(userId => ({
      PutRequest: {
        Item: {
          user_id: { S: userId },
          event_id: { S: eventId },
          ticker: { S: eventData.ticker },
          timestamp: { S: eventData.timestamp },
          ttl: { N: ttl.toString() }
        }
      }
    }));

    try {
      await dynamoDB.send(new BatchWriteItemCommand({
        RequestItems: {
          'user-events': putRequests
        }
      }));

      console.log(`[UserEventRelationships] Batch ${i + 1}/${batches.length} complete (${batch.length} relationships)`);
    } catch (error) {
      console.error(`[UserEventRelationships] Error writing batch ${i + 1}:`, error);
      throw error;
    }
  }

  console.log(`[UserEventRelationships] Successfully created ${userIdArray.length} relationships for event ${eventId}`);
}

/**
 * Exports
 */
export { createUserEventRelationships, chunkArray };
