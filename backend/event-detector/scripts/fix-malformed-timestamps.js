#!/usr/bin/env node
/**
 * Data Migration Script: Fix Malformed Timestamps in portfolio-events Table
 *
 * This script identifies and fixes events with malformed timestamps that contain
 * "GMT-05:00" instead of the proper ISO 8601 format "-05:00".
 *
 * Usage:
 *   node fix-malformed-timestamps.js [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be changed without making updates
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'portfolio-events';
const MALFORMED_PATTERN = /GMT([+-]\d{2}:\d{2})/;
const DRY_RUN = process.argv.includes('--dry-run');

// Initialize DynamoDB client
const client = new DynamoDBClient({});
const dynamoDB = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true }
});

/**
 * Fixes a malformed timestamp by removing the "GMT" prefix
 */
function fixTimestamp(timestamp) {
  if (typeof timestamp !== 'string') {
    return null;
  }

  const match = timestamp.match(MALFORMED_PATTERN);
  if (!match) {
    return null; // Timestamp is not malformed
  }

  // Replace "GMT-05:00" with "-05:00"
  return timestamp.replace(MALFORMED_PATTERN, '$1');
}

/**
 * Updates a single event's timestamp in DynamoDB
 */
async function updateEvent(eventId, oldTimestamp, newTimestamp) {
  try {
    await dynamoDB.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { event_id: eventId },
      UpdateExpression: 'SET #ts = :newTimestamp',
      ExpressionAttributeNames: {
        '#ts': 'timestamp'
      },
      ExpressionAttributeValues: {
        ':newTimestamp': newTimestamp,
        ':oldTimestamp': oldTimestamp
      },
      ConditionExpression: '#ts = :oldTimestamp',
      ReturnValues: 'NONE'
    }));

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Scans the entire table and fixes malformed timestamps
 */
async function scanAndFix() {
  let scannedCount = 0;
  let malformedCount = 0;
  let fixedCount = 0;
  let errorCount = 0;
  const errors = [];

  console.log(`Starting scan of ${TABLE_NAME} table...`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE (updates will be applied)'}\n`);

  let lastEvaluatedKey = undefined;

  do {
    const scanResult = await dynamoDB.send(new ScanCommand({
      TableName: TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey
    }));

    const items = scanResult.Items || [];
    scannedCount += items.length;

    for (const item of items) {
      const { event_id, timestamp } = item;

      if (!timestamp) {
        continue;
      }

      const fixedTimestamp = fixTimestamp(timestamp);

      if (fixedTimestamp) {
        malformedCount++;
        console.log(`\nFound malformed timestamp:`);
        console.log(`  Event ID:  ${event_id}`);
        console.log(`  Old:       ${timestamp}`);
        console.log(`  New:       ${fixedTimestamp}`);

        if (!DRY_RUN) {
          const result = await updateEvent(event_id, timestamp, fixedTimestamp);

          if (result.success) {
            console.log(`  Status:    ✓ Fixed`);
            fixedCount++;
          } else {
            console.log(`  Status:    ✗ Error - ${result.error}`);
            errorCount++;
            errors.push({ event_id, error: result.error });
          }
        } else {
          console.log(`  Status:    [DRY RUN - would be fixed]`);
        }
      }
    }

    lastEvaluatedKey = scanResult.LastEvaluatedKey;

    // Progress update
    if (scannedCount % 100 === 0) {
      console.log(`\n... scanned ${scannedCount} items so far`);
    }

  } while (lastEvaluatedKey);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total events scanned:      ${scannedCount}`);
  console.log(`Malformed timestamps found: ${malformedCount}`);

  if (!DRY_RUN) {
    console.log(`Successfully fixed:         ${fixedCount}`);
    console.log(`Errors encountered:         ${errorCount}`);

    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.forEach(({ event_id, error }) => {
        console.log(`  - ${event_id}: ${error}`);
      });
    }
  } else {
    console.log('\n⚠️  This was a DRY RUN. No changes were made.');
    console.log('Run without --dry-run flag to apply fixes.');
  }

  console.log('='.repeat(60));
}

/**
 * Main execution
 */
async function main() {
  try {
    await scanAndFix();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
