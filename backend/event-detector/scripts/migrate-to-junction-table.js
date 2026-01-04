/**
 * Migration Script: Backfill user-events Junction Table
 *
 * This script migrates existing events from portfolio-events to the new
 * user-events junction table model. Each event with a user_id will create
 * a corresponding entry in the user-events table.
 *
 * Usage:
 *   AWS_REGION=us-east-1 node scripts/migrate-to-junction-table.js
 */

import { DynamoDBClient, ScanCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const dynamoDB = new DynamoDBClient({ region: AWS_REGION });

/**
 * Chunks an array into smaller arrays of specified size
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Main migration function
 */
async function migrateToJunctionTable() {
  console.log('='.repeat(80));
  console.log('MIGRATION: Backfill user-events Junction Table');
  console.log('='.repeat(80));

  try {
    // Step 1: Scan all events in portfolio-events table
    console.log('\nStep 1: Scanning portfolio-events table...');

    let allEvents = [];
    let lastEvaluatedKey = undefined;

    do {
      const scanCommand = new ScanCommand({
        TableName: 'portfolio-events',
        ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
      });

      const scanResponse = await dynamoDB.send(scanCommand);
      const events = scanResponse.Items || [];
      allEvents = allEvents.concat(events);

      lastEvaluatedKey = scanResponse.LastEvaluatedKey;

      console.log(`  Scanned ${events.length} events (total: ${allEvents.length})`);
    } while (lastEvaluatedKey);

    console.log(`\nFound ${allEvents.length} total events in portfolio-events table`);

    // Step 2: Filter events that have user_id
    const eventsWithUserId = allEvents.filter(event => event.user_id && event.user_id.S);
    console.log(`Found ${eventsWithUserId.length} events with user_id to migrate`);

    if (eventsWithUserId.length === 0) {
      console.log('\nNo events to migrate. Migration complete!');
      return;
    }

    // Step 3: Create user-event relationships for each event
    console.log('\nStep 2: Creating user-event relationships...');

    const batches = chunkArray(eventsWithUserId, 25); // DynamoDB batch limit
    let migratedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      const putRequests = batch.map(event => {
        // Validate required fields
        if (!event.event_id || !event.event_id.S) {
          console.warn(`  SKIP: Event missing event_id`);
          return null;
        }
        if (!event.ticker || !event.ticker.S) {
          console.warn(`  SKIP: Event ${event.event_id.S} missing ticker`);
          return null;
        }
        if (!event.timestamp || !event.timestamp.S) {
          console.warn(`  SKIP: Event ${event.event_id.S} missing timestamp`);
          return null;
        }

        // Handle missing or malformed ttl
        let ttl;
        if (event.ttl && event.ttl.N) {
          ttl = event.ttl;
        } else {
          // Calculate new TTL: 30 days from now
          ttl = { N: Math.floor(Date.now() / 1000 + 30 * 24 * 60 * 60).toString() };
        }

        return {
          PutRequest: {
            Item: {
              user_id: { S: event.user_id.S },
              event_id: { S: event.event_id.S },
              ticker: { S: event.ticker.S },
              timestamp: { S: event.timestamp.S },
              ttl: ttl
            }
          }
        };
      }).filter(item => item !== null); // Remove null items

      if (putRequests.length === 0) {
        console.log(`  Batch ${i + 1}/${batches.length} skipped (no valid items)`);
        continue;
      }

      try {
        await dynamoDB.send(new BatchWriteItemCommand({
          RequestItems: {
            'user-events': putRequests
          }
        }));

        migratedCount += putRequests.length;
        console.log(`  Batch ${i + 1}/${batches.length} complete (${migratedCount}/${eventsWithUserId.length} events migrated)`);
      } catch (error) {
        console.error(`  ERROR in batch ${i + 1}:`, error.message);
        errorCount += putRequests.length;
      }
    }

    // Step 4: Summary
    console.log('\n' + '='.repeat(80));
    console.log('MIGRATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total events scanned:    ${allEvents.length}`);
    console.log(`Events with user_id:     ${eventsWithUserId.length}`);
    console.log(`Successfully migrated:   ${migratedCount}`);
    console.log(`Errors:                  ${errorCount}`);
    console.log('\nMigration complete!');

    if (errorCount > 0) {
      console.log('\nWARNING: Some events failed to migrate. Review errors above.');
      process.exit(1);
    }

  } catch (error) {
    console.error('\nFATAL ERROR during migration:', error);
    process.exit(1);
  }
}

// Run migration
migrateToJunctionTable();
