# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the **Event Detector** Lambda function, part of a larger Portfolio Intelligence Agent system. It monitors financial news and SEC filings for stocks in user watchlists, detects new events, and triggers downstream AI analysis.

**Sibling Component**: The `event-processor` Lambda (in `../event-processor/`) consumes events via SNS and performs RAG-based AI analysis using Claude, Pinecone, and historical context.

## Architecture

### Multi-User Event Detection with Deduplication

The system implements an efficient architecture to minimize API calls when multiple users watch the same stocks:

1. **Ticker Aggregation**: Loads all user watchlists from DynamoDB and aggregates tickers (e.g., if 10 users watch TSLA, we query TSLA once, not 10 times)
2. **Single Event Storage**: Each event is stored once in `portfolio-events` table with a `watcher_count`
3. **Junction Table**: `user-events` table creates relationships between users and events (many-to-many)
4. **Batch Processing**: User-event relationships are created in batches of 25 (DynamoDB limit)

### Data Flow

```
1. Load all user watchlists from DynamoDB (user-watchlists table)
2. Aggregate tickers → Map<ticker, Set<userIds>>
3. For each unique ticker:
   a. Query Alpha Vantage News API
   b. Query SEC Edgar 8-K filings API
4. For each new event:
   a. Store in portfolio-events (once, with watcher_count)
   b. Create user-event relationships in junction table
   c. Publish to SNS with array of all watching userIds
5. SNS triggers event-processor Lambda for AI analysis
```

### DynamoDB Tables

- **user-watchlists**: `user_id` (PK) → `tickers` (list)
  - Supports both legacy format `{S: "TSLA"}` and new format `{M: {symbol: {S: "TSLA"}}}`
- **portfolio-events**: `event_id` (PK) → event data (ticker, type, headline, URL, sentiment, watcher_count, etc.)
- **user-events**: Composite key `user_id` (PK) + `event_id` (SK) → minimal data (ticker, timestamp, TTL)

### Event Sources

#### Alpha Vantage News
- Queries NEWS_SENTIMENT API for each ticker
- Configurable schedule (default: 6, 10, 13, 16, 20 hours ET)
- Custom timestamp conversion to ISO 8601 with timezone
- Returns: title, URL, sentiment score, summary

#### SEC Edgar 8-K Filings
- Fetches company_tickers.json to map ticker → CIK
- Queries submissions data for recent 8-K filings (30-day lookback)
- Enriches filings by parsing primary document + exhibits (EX-99.1)
- Extracts Item numbers (e.g., 2.02 Financial Results, 5.02 Officer Changes)
- Returns: form type, accession number, filing date, items, headline, summary

## Commands

### Development

```bash
# Install dependencies
npm install

# Run locally (requires AWS credentials and .env file)
node index.js

# Manage watchlists
node scripts/manage-watchlist.js list-users
node scripts/manage-watchlist.js add-user user_123 NVDA,TSLA,AAPL
node scripts/manage-watchlist.js add-ticker user_123 META
node scripts/manage-watchlist.js remove-ticker user_123 NVDA
```

### Deployment

```bash
# Deploy to AWS Lambda
./deploy-lambda.sh

# The script:
# 1. Creates function.zip with all files
# 2. Updates event-detector Lambda function
# 3. Tails CloudWatch logs for verification
```

### Database Maintenance

```bash
# Fix malformed timestamps in portfolio-events
node scripts/fix-malformed-timestamps.js

# Test timestamp fixes
node scripts/test-timestamp-fix.js

# Migrate from old schema to junction table
node scripts/migrate-to-junction-table.js
```

## Environment Variables

Required in AWS Lambda configuration:

- `AWS_REGION`: AWS region (e.g., us-east-1)
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key
- `SNS_TOPIC_ARN`: ARN of SNS topic for publishing events
- `WATCHLIST`: Fallback watchlist if no users in DynamoDB (JSON array)

Optional:
- `ALPHA_VANTAGE_LOOKBACK_HOURS`: News lookback window (default: 6)
- `ALPHA_VANTAGE_QUERY_HOURS`: Comma-separated hours to query (default: 6,10,13,16,20)
- `QUERY_TIMEZONE`: Timezone for scheduling (default: America/New_York)

## Key Implementation Details

### Deduplication
- Event IDs are generated using SHA-256 hash of `url + timestamp` (first 16 chars)
- Before inserting, checks if event_id exists in portfolio-events table
- Uses DynamoDB `ConditionExpression: 'attribute_not_exists(event_id)'` for atomic inserts

### Ticker Aggregation Pattern
Instead of processing each user's watchlist independently:
```javascript
// OLD (inefficient): Query API once per user per ticker
for (user in users) {
  for (ticker in user.watchlist) {
    queryAPI(ticker) // Could query TSLA 100 times if 100 users watch it
  }
}

// NEW (efficient): Aggregate first, query once per ticker
tickerToUsers = aggregateTickersFromWatchlists(userWatchlists)
for (ticker in tickerToUsers) {
  events = queryAPI(ticker) // Query TSLA exactly once
  for (event in events) {
    storeEventOnce(event)
    createUserEventRelationships(event, tickerToUsers[ticker])
  }
}
```

### Watchlist Format Handling
The code handles both legacy and new watchlist formats:
```javascript
// Legacy: {L: [{S: "TSLA"}, {S: "NVDA"}]}
// New: {L: [{M: {symbol: {S: "TSLA"}, name: {S: "Tesla"}}}, ...]}
const tickers = item.tickers.L.map(ticker => {
  return ticker.M?.symbol ? ticker.M.symbol.S : ticker.S;
});
```

### SEC Edgar Content Extraction
Priority order for 8-K content:
1. EX-99.1 exhibits (press releases) - highest priority
2. EX-99 exhibits
3. Primary 8-K document with Item parsing

Items are mapped to human-readable descriptions (e.g., "2.02" → "Financial Results")

### Alpha Vantage Timestamp Handling
Alpha Vantage returns timestamps in `YYYYMMDDTHHmmss` format without timezone. The code:
1. Parses the compact format
2. Converts to ISO 8601 with proper timezone offset
3. Example: `20251231T172712` → `2025-12-31T17:27:12-05:00`

## Testing Considerations

- Lambda is typically triggered by CloudWatch Events (EventBridge) on a schedule
- Can be invoked manually via AWS Console or CLI for testing
- Use `manage-watchlist.js` to set up test users before running
- Check CloudWatch Logs for detailed execution traces
- The function returns status 200 with count of new events detected
