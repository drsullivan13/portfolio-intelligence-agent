import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });
const TABLE_NAME = 'user-watchlists';

// Helper to print usage
function printUsage() {
  console.log(`
Usage: node manage-watchlist.js <command> [arguments]

Commands:
  add-user <user_id> <ticker1,ticker2,...>    Add a new user with tickers
  remove-user <user_id>                       Remove a user
  update-tickers <user_id> <ticker1,ticker2>  Replace user's tickers
  add-ticker <user_id> <ticker>               Add a ticker to existing user
  remove-ticker <user_id> <ticker>            Remove a ticker from user
  list-users                                  List all users and their watchlists
  get-user <user_id>                          Get specific user's watchlist

Examples:
  node manage-watchlist.js add-user user_123 NVDA,TSLA,AAPL
  node manage-watchlist.js update-tickers user_123 NVDA,MSFT,GOOGL
  node manage-watchlist.js add-ticker user_123 META
  node manage-watchlist.js remove-ticker user_123 NVDA
  node manage-watchlist.js list-users
  node manage-watchlist.js get-user user_123
  node manage-watchlist.js remove-user user_123
  `);
}

// Add a new user
async function addUser(userId, tickersString) {
  const tickers = tickersString.split(',').map(t => t.trim().toUpperCase());

  const item = {
    user_id: { S: userId },
    tickers: { L: tickers.map(t => ({ S: t })) },
    created_at: { S: new Date().toISOString() },
    updated_at: { S: new Date().toISOString() }
  };

  await dynamoDB.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(user_id)'
  }));

  console.log(`✓ Added user: ${userId}`);
  console.log(`  Tickers: ${tickers.join(', ')}`);
}

// Remove a user
async function removeUser(userId) {
  await dynamoDB.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } }
  }));

  console.log(`✓ Removed user: ${userId}`);
}

// Update user's tickers (replace all)
async function updateTickers(userId, tickersString) {
  const tickers = tickersString.split(',').map(t => t.trim().toUpperCase());

  await dynamoDB.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } },
    UpdateExpression: 'SET tickers = :tickers, updated_at = :updated',
    ExpressionAttributeValues: {
      ':tickers': { L: tickers.map(t => ({ S: t })) },
      ':updated': { S: new Date().toISOString() }
    },
    ConditionExpression: 'attribute_exists(user_id)'
  }));

  console.log(`✓ Updated tickers for user: ${userId}`);
  console.log(`  New tickers: ${tickers.join(', ')}`);
}

// Add a single ticker to existing user
async function addTicker(userId, ticker) {
  ticker = ticker.trim().toUpperCase();

  // Get current tickers
  const result = await dynamoDB.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } }
  }));

  if (!result.Item) {
    throw new Error(`User not found: ${userId}`);
  }

  const currentTickers = result.Item.tickers.L.map(t => t.S);

  if (currentTickers.includes(ticker)) {
    console.log(`Ticker ${ticker} already exists for user ${userId}`);
    return;
  }

  const newTickers = [...currentTickers, ticker];

  await dynamoDB.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } },
    UpdateExpression: 'SET tickers = :tickers, updated_at = :updated',
    ExpressionAttributeValues: {
      ':tickers': { L: newTickers.map(t => ({ S: t })) },
      ':updated': { S: new Date().toISOString() }
    }
  }));

  console.log(`✓ Added ticker ${ticker} to user: ${userId}`);
  console.log(`  All tickers: ${newTickers.join(', ')}`);
}

// Remove a single ticker from user
async function removeTicker(userId, ticker) {
  ticker = ticker.trim().toUpperCase();

  // Get current tickers
  const result = await dynamoDB.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } }
  }));

  if (!result.Item) {
    throw new Error(`User not found: ${userId}`);
  }

  const currentTickers = result.Item.tickers.L.map(t => t.S);
  const newTickers = currentTickers.filter(t => t !== ticker);

  if (newTickers.length === currentTickers.length) {
    console.log(`Ticker ${ticker} not found for user ${userId}`);
    return;
  }

  if (newTickers.length === 0) {
    console.log(`Cannot remove last ticker. Use remove-user instead.`);
    return;
  }

  await dynamoDB.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } },
    UpdateExpression: 'SET tickers = :tickers, updated_at = :updated',
    ExpressionAttributeValues: {
      ':tickers': { L: newTickers.map(t => ({ S: t })) },
      ':updated': { S: new Date().toISOString() }
    }
  }));

  console.log(`✓ Removed ticker ${ticker} from user: ${userId}`);
  console.log(`  Remaining tickers: ${newTickers.join(', ')}`);
}

// List all users
async function listUsers() {
  const result = await dynamoDB.send(new ScanCommand({
    TableName: TABLE_NAME
  }));

  if (!result.Items || result.Items.length === 0) {
    console.log('No users found');
    return;
  }

  console.log(`\nFound ${result.Items.length} user(s):\n`);

  for (const item of result.Items) {
    const userId = item.user_id.S;
    const tickers = item.tickers.L.map(t => t.S);
    const createdAt = item.created_at.S;
    const updatedAt = item.updated_at.S;

    console.log(`User: ${userId}`);
    console.log(`  Tickers: ${tickers.join(', ')}`);
    console.log(`  Created: ${createdAt}`);
    console.log(`  Updated: ${updatedAt}`);
    console.log('');
  }
}

// Get specific user
async function getUser(userId) {
  const result = await dynamoDB.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: { user_id: { S: userId } }
  }));

  if (!result.Item) {
    console.log(`User not found: ${userId}`);
    return;
  }

  const tickers = result.Item.tickers.L.map(t => t.S);
  const createdAt = result.Item.created_at.S;
  const updatedAt = result.Item.updated_at.S;

  console.log(`\nUser: ${userId}`);
  console.log(`  Tickers: ${tickers.join(', ')}`);
  console.log(`  Created: ${createdAt}`);
  console.log(`  Updated: ${updatedAt}\n`);
}

// Main function
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'add-user':
        if (args.length < 3) {
          console.error('Error: add-user requires user_id and tickers');
          printUsage();
          process.exit(1);
        }
        await addUser(args[1], args[2]);
        break;

      case 'remove-user':
        if (args.length < 2) {
          console.error('Error: remove-user requires user_id');
          printUsage();
          process.exit(1);
        }
        await removeUser(args[1]);
        break;

      case 'update-tickers':
        if (args.length < 3) {
          console.error('Error: update-tickers requires user_id and tickers');
          printUsage();
          process.exit(1);
        }
        await updateTickers(args[1], args[2]);
        break;

      case 'add-ticker':
        if (args.length < 3) {
          console.error('Error: add-ticker requires user_id and ticker');
          printUsage();
          process.exit(1);
        }
        await addTicker(args[1], args[2]);
        break;

      case 'remove-ticker':
        if (args.length < 3) {
          console.error('Error: remove-ticker requires user_id and ticker');
          printUsage();
          process.exit(1);
        }
        await removeTicker(args[1], args[2]);
        break;

      case 'list-users':
        await listUsers();
        break;

      case 'get-user':
        if (args.length < 2) {
          console.error('Error: get-user requires user_id');
          printUsage();
          process.exit(1);
        }
        await getUser(args[1]);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
