import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoDB = new DynamoDBClient({ region: 'us-east-1' });
const TABLE_NAME = 'portfolio-events';
const DEFAULT_USER_ID = 'admin-001';

async function migrateAddUserId() {
  console.log(`Starting migration: Adding user_id attribute to all items in ${TABLE_NAME}`);
  console.log(`Default user_id: ${DEFAULT_USER_ID}\n`);

  let itemsProcessed = 0;
  let itemsUpdated = 0;
  let itemsSkipped = 0;
  let errors = 0;

  try {
    // Scan the table to get all items
    let lastEvaluatedKey = null;

    do {
      const scanParams = {
        TableName: TABLE_NAME,
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
      };

      console.log('Scanning for items...');
      const scanResult = await dynamoDB.send(new ScanCommand(scanParams));

      if (!scanResult.Items || scanResult.Items.length === 0) {
        console.log('No more items to process');
        break;
      }

      console.log(`Found ${scanResult.Items.length} items in this batch\n`);

      // Process each item
      for (const item of scanResult.Items) {
        itemsProcessed++;
        const eventId = item.event_id.S;

        try {
          // Check if user_id already exists
          if (item.user_id) {
            console.log(`[${itemsProcessed}] Skipping ${eventId} - user_id already exists: ${item.user_id.S}`);
            itemsSkipped++;
            continue;
          }

          // Add user_id attribute using UpdateItem
          const updateParams = {
            TableName: TABLE_NAME,
            Key: {
              event_id: { S: eventId }
            },
            UpdateExpression: 'SET user_id = :userId',
            ExpressionAttributeValues: {
              ':userId': { S: DEFAULT_USER_ID }
            },
            ReturnValues: 'NONE'
          };

          await dynamoDB.send(new UpdateItemCommand(updateParams));
          console.log(`[${itemsProcessed}] ✓ Updated ${eventId} with user_id: ${DEFAULT_USER_ID}`);
          itemsUpdated++;

        } catch (error) {
          console.error(`[${itemsProcessed}] ✗ Error updating ${eventId}:`, error.message);
          errors++;
        }
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
      console.log(''); // Empty line for readability

    } while (lastEvaluatedKey);

  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  }

  // Print summary
  console.log('\n=== Migration Complete ===');
  console.log(`Total items processed: ${itemsProcessed}`);
  console.log(`Items updated: ${itemsUpdated}`);
  console.log(`Items skipped (already had user_id): ${itemsSkipped}`);
  console.log(`Errors: ${errors}`);

  if (errors > 0) {
    console.log('\n⚠️  Some items failed to update. Please review errors above.');
    process.exit(1);
  } else {
    console.log('\n✓ All items successfully migrated!');
  }
}

// Run migration
migrateAddUserId().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
