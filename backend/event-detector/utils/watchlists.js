import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE_NAME = 'user-watchlists';

/**
 * Load all user watchlists from DynamoDB
 * @returns {Promise<Map<string, string[]>>} Map of user_id to array of tickers
 */
async function loadAllWatchlists() {
  try {
    console.log(`Loading all watchlists from ${TABLE_NAME}...`);

    const result = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME
    }));

    const watchlists = new Map();

    if (!result.Items || result.Items.length === 0) {
      console.log('No watchlists found in table');
      return watchlists;
    }

    // Parse each user's watchlist
    for (const item of result.Items) {
      const userId = item.user_id.S;
      const tickers = item.tickers.L.map(ticker => ticker.S);

      watchlists.set(userId, tickers);
      console.log(`Loaded watchlist for ${userId}: ${tickers.join(', ')}`);
    }

    console.log(`Total watchlists loaded: ${watchlists.size}`);
    return watchlists;

  } catch (error) {
    console.error('Error loading watchlists:', error);
    throw new Error(`Failed to load watchlists: ${error.message}`);
  }
}

/**
 * Load watchlist for a specific user
 * @param {string} userId - User ID to load watchlist for
 * @returns {Promise<string[]|null>} Array of tickers or null if user not found
 */
async function loadUserWatchlist(userId) {
  try {
    console.log(`Loading watchlist for user: ${userId}`);

    const result = await dynamoDB.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: {
        user_id: { S: userId }
      }
    }));

    if (!result.Item) {
      console.log(`No watchlist found for user: ${userId}`);
      return null;
    }

    const tickers = result.Item.tickers.L.map(ticker => ticker.S);
    console.log(`Watchlist for ${userId}: ${tickers.join(', ')}`);

    return tickers;

  } catch (error) {
    console.error(`Error loading watchlist for ${userId}:`, error);
    throw new Error(`Failed to load watchlist for ${userId}: ${error.message}`);
  }
}

export { loadAllWatchlists, loadUserWatchlist };
