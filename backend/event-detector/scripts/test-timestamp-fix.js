#!/usr/bin/env node
/**
 * Test Script: Verify Timestamp Fix
 *
 * Tests that the fixed timestamp conversion logic produces valid ISO 8601 timestamps
 */

/**
 * Simulates the FIXED convertAlphaVantageTimestamp function
 */
function convertAlphaVantageTimestamp(alphaVantageTime, timezone = 'America/New_York') {
  // Parse: YYYYMMDDTHHmmss
  const year = alphaVantageTime.substring(0, 4);
  const month = alphaVantageTime.substring(4, 6);
  const day = alphaVantageTime.substring(6, 8);
  const hour = alphaVantageTime.substring(9, 11);
  const minute = alphaVantageTime.substring(11, 13);
  const second = alphaVantageTime.substring(13, 15);

  // Create date string
  const dateString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const date = new Date(dateString + 'Z');

  // Convert to target timezone and get ISO string with offset
  const options = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset'
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const formatted = {};
  parts.forEach(part => {
    formatted[part.type] = part.value;
  });

  // FIXED: Remove "GMT" prefix using substring(3)
  const timezoneOffset = formatted.timeZoneName.substring(3);
  const isoString = `${formatted.year}-${formatted.month}-${formatted.day}T${formatted.hour}:${formatted.minute}:${formatted.second}${timezoneOffset}`;

  return isoString;
}

/**
 * Simulates the FIXED frontend parseEventTimestamp function
 */
function parseEventTimestamp(timestamp) {
  if (!timestamp) {
    return new Date();
  }

  // Handle compact format: 20251231T170828
  if (/^\d{8}T\d{6}/.test(timestamp)) {
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const hour = timestamp.substring(9, 11);
    const minute = timestamp.substring(11, 13);
    const second = timestamp.substring(13, 15);

    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  }

  // FIXED: Handle malformed timestamps with "GMT-05:00"
  const cleanedTimestamp = timestamp.replace(/GMT([+-]\d{2}:\d{2})/, '$1');
  const parsed = new Date(cleanedTimestamp);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

/**
 * Validates that a timestamp is proper ISO 8601 format
 */
function isValidISO8601(timestamp) {
  // Should match: YYYY-MM-DDTHH:mm:ss±HH:MM
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
  return iso8601Pattern.test(timestamp);
}

/**
 * Run tests
 */
function runTests() {
  console.log('Testing Timestamp Fixes\n');
  console.log('='.repeat(70));

  // Test cases from Alpha Vantage
  const testCases = [
    { input: '20260102T043816', description: 'Morning EST time' },
    { input: '20260102T040808', description: 'Early morning EST time' },
    { input: '20260102T111331', description: 'Late morning EST time' },
    { input: '20251231T172712', description: 'Evening EST time' }
  ];

  let passCount = 0;
  let failCount = 0;

  console.log('\n1. Testing Backend Fix (convertAlphaVantageTimestamp):\n');

  testCases.forEach(({ input, description }) => {
    const result = convertAlphaVantageTimestamp(input);
    const isValid = isValidISO8601(result);
    const status = isValid ? '✓ PASS' : '✗ FAIL';

    console.log(`  ${description}`);
    console.log(`    Input:  ${input}`);
    console.log(`    Output: ${result}`);
    console.log(`    Valid:  ${status}`);
    console.log();

    if (isValid) {
      passCount++;
    } else {
      failCount++;
    }
  });

  console.log('='.repeat(70));
  console.log('\n2. Testing Frontend Fix (parseEventTimestamp):\n');

  // Test parsing malformed timestamps (old format from database)
  const malformedTimestamps = [
    { timestamp: '2026-01-02T04:38:16GMT-05:00', description: 'Malformed with GMT prefix' },
    { timestamp: '2026-01-02T04:08:08GMT-05:00', description: 'Another malformed timestamp' },
    { timestamp: '2026-01-02T09:20:13-05:00', description: 'Properly formatted timestamp' },
    { timestamp: '20260101T111331', description: 'Compact format timestamp' }
  ];

  malformedTimestamps.forEach(({ timestamp, description }) => {
    const result = parseEventTimestamp(timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now.getTime() - result.getTime());

    // If result is close to current time (within 5 seconds), parsing failed
    const isFallback = timeDiff < 5000;
    const status = !isFallback ? '✓ PASS' : '✗ FAIL';

    console.log(`  ${description}`);
    console.log(`    Input:  ${timestamp}`);
    console.log(`    Output: ${result.toISOString()}`);
    console.log(`    Status: ${status} ${isFallback ? '(fell back to current time - parsing failed!)' : '(parsed correctly)'}`);
    console.log();

    if (!isFallback) {
      passCount++;
    } else {
      failCount++;
    }
  });

  console.log('='.repeat(70));
  console.log('\nTest Summary:');
  console.log(`  Total tests: ${passCount + failCount}`);
  console.log(`  Passed:      ${passCount} ✓`);
  console.log(`  Failed:      ${failCount} ${failCount > 0 ? '✗' : ''}`);
  console.log('='.repeat(70));

  return failCount === 0;
}

// Run tests and exit with appropriate code
const success = runTests();
process.exit(success ? 0 : 1);
