import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);
const WATCHLIST_TABLE = 'user-watchlists';

/**
 * Chunks array into batches
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Batch fetch user settings (including webhook URLs) for multiple users
 *
 * @param {string[]} userIds - Array of user IDs
 * @returns {Promise<Map<userId, {webhook_url}>>} Map of user ID to settings
 */
async function fetchUserSettings(userIds) {
  if (!userIds || userIds.length === 0) {
    console.log('[UserSettings] No users to fetch settings for');
    return new Map();
  }

  console.log(`[UserSettings] Fetching settings for ${userIds.length} users`);

  const userSettings = new Map();
  const batches = chunkArray(userIds, 100); // DynamoDB BatchGet limit

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      const response = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [WATCHLIST_TABLE]: {
            Keys: batch.map(userId => ({ user_id: userId }))
          }
        }
      }));

      const items = response.Responses?.[WATCHLIST_TABLE] || [];

      items.forEach(item => {
        userSettings.set(item.user_id, {
          webhook_url: item.webhook_url || null
        });
      });

      console.log(`[UserSettings] Batch ${i + 1}/${batches.length} complete (${items.length} settings fetched)`);
    } catch (error) {
      console.error(`[UserSettings] Error fetching batch ${i + 1}:`, error);
      // Don't throw - continue with other batches
      // Users in failed batch will use default webhook
    }
  }

  // For users not found in DynamoDB, set webhook_url to null (will use default)
  userIds.forEach(userId => {
    if (!userSettings.has(userId)) {
      console.log(`[UserSettings] User ${userId} not found in watchlists table, using default webhook`);
      userSettings.set(userId, { webhook_url: null });
    }
  });

  console.log(`[UserSettings] Fetched settings for ${userSettings.size} users`);
  return userSettings;
}

export { fetchUserSettings };
