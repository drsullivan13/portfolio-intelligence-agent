# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Portfolio Intelligence Agent is a production-grade, event-driven serverless platform that monitors financial markets and provides AI-powered investment insights. The system processes SEC filings and market news, using RAG (Retrieval-Augmented Generation) with Claude Sonnet 4.5 to deliver contextualized analysis to portfolio managers.

**Architecture Pattern**: Two-Lambda event-driven pipeline with SNS pub/sub decoupling
- **event-detector**: Monitors SEC EDGAR and Alpha Vantage, publishes events to SNS
- **event-processor**: Consumes SNS events, performs RAG analysis with Claude, stores results

## Runtime Preferences

**IMPORTANT**: Prefer Bun over npm/Node.js wherever possible:
- Use `bun install` instead of `npm install`
- Use `bun run` instead of `npm run` or `node`
- Use `bun test` instead of `jest` or `vitest`
- Bun automatically loads `.env` files (no dotenv package needed in new code)

**Current State**:
- `backend/event-processor/` uses Bun (preferred)
- `backend/event-detector/` uses Node.js (AWS Lambda runtime constraint)

## Commands

### Development

```bash
# Event Detector (Node.js - Lambda runtime constraint)
cd backend/event-detector
npm install                                      # Only here due to Lambda
node index.js                                    # Run locally (bypasses schedule check)
node scripts/manage-watchlist.js list-users      # List all users
node scripts/manage-watchlist.js add-user <id> <tickers>

# Event Processor (Bun - preferred)
cd backend/event-processor
bun install                                      # Use bun, not npm
bun run test-local.js                            # Test full pipeline locally
```

### Deployment

```bash
# Deploy event-detector
cd backend/event-detector
./deploy-lambda.sh                               # Builds zip, updates Lambda, tails logs

# Deploy event-processor
cd backend/event-processor
./deploy-lambda.sh                               # Builds zip, updates Lambda, tails logs
```

### Testing & Debugging

```bash
# Invoke Lambda manually
aws lambda invoke --function-name event-detector --payload '{}' response.json
aws lambda invoke --function-name event-processor --payload '{}' response.json

# Monitor logs
aws logs tail /aws/lambda/event-detector --follow
aws logs tail /aws/lambda/event-processor --follow

# Query recent events
aws dynamodb scan --table-name portfolio-events --limit 5

# Test Pinecone connectivity (use bun)
cd backend
bun run test-pinecone.js

# Backfill historical events (use bun)
cd backend
bun run backfill-events.js
```

## System Architecture

### Multi-User Event Processing with Deduplication

The system efficiently handles multiple users watching the same stocks:

1. **Ticker Aggregation**: All user watchlists loaded from `user-watchlists` DynamoDB table
2. **Single Query Per Ticker**: API called once per ticker, regardless of user count
3. **Single Event Storage**: Each event stored once in `portfolio-events` with `watcher_count`
4. **Junction Table**: `user-events` creates many-to-many relationships between users and events
5. **Batch SNS Publishing**: Single SNS message contains array of all watching `userIds`

**Benefits**: Reduces API calls, storage, and processing costs when 100+ users watch popular stocks.

### Event Flow

```
EventBridge (cron)
  → event-detector Lambda
    → Alpha Vantage API (news)
    → SEC EDGAR API (8-K filings)
    → DynamoDB (portfolio-events, user-events tables)
    → SNS Topic (portfolio-events)
      → event-processor Lambda
        → OpenAI (embeddings)
        → Pinecone (vector search)
        → Claude Sonnet 4.5 (analysis)
        → DynamoDB (update with analysis)
        → S3 (archive report)
        → Slack (notification)
```

### DynamoDB Tables

**user-watchlists**
- PK: `user_id` (String)
- Attributes: `tickers` (List of Maps with `symbol` field)
- Supports legacy format: `{S: "TSLA"}` and new format: `{M: {symbol: {S: "TSLA"}}}`

**portfolio-events**
- PK: `event_id` (String) - SHA-256 hash of `url + timestamp` (first 16 chars)
- Attributes: `ticker`, `event_type`, `timestamp`, `headline`, `url`, `sentiment_score`, `items_reported`, `status`, `analysis`, `ttl`
- TTL: Auto-expire after 90 days

**user-events** (Junction Table)
- PK: `user_id` (String)
- SK: `event_id` (String)
- Attributes: `ticker`, `timestamp`, `ttl`
- Enables efficient user-specific event queries

### Pinecone Vector Store

- **Index**: `portfolio-events` (serverless)
- **Dimensions**: 1536 (OpenAI text-embedding-3-small)
- **Metadata**: `ticker`, `event_type`, `timestamp` (numeric milliseconds), `headline`, `url`
- **Query Strategy**: Cosine similarity with 30-day rolling window filter

## Key Implementation Patterns

### 1. SEC 8-K Filing Enrichment

The event-detector extracts detailed content from SEC filings (see `backend/event-detector/sources/secEdgar.js`):

- Maps ticker → CIK using `company_tickers.json`
- Fetches submission history for 8-K filings (30-day lookback)
- Parses primary document + exhibits (prioritizes EX-99.1 press releases)
- Extracts Item numbers with regex: `/Item\s+(\d+\.\d+)/gi`
- Maps Items to descriptions (e.g., "2.02" → "Financial Results")
- Builds enriched headline and summary with Item context

**Priority Order for Content**:
1. EX-99.1 exhibits (press releases) - most informative
2. EX-99 exhibits
3. Primary 8-K document with Item parsing

### 2. RAG Context Assembly

The event-processor builds rich context for Claude (see `backend/event-processor/rag/contextBuilder.js`):

1. Generate 1536-dim embedding for current event
2. Query Pinecone for similar events (cosine similarity)
3. Filter: `timestamp >= now - 30 days` AND `ticker = X`
4. Return top 10 results with relevance scores
5. Build prompt: current event + sorted similar events

**Context Prompt Structure**:
```
CURRENT EVENT:
Type: SEC_FILING
Ticker: TSLA
Headline: 8-K Filing: Item 2.02 - Financial Results
Date: 2025-01-01T12:00:00Z
Summary: [extracted content]

RECENT RELATED CONTEXT (3 similar events):
1. [TSLA] Previous earnings announcement
   Date: 2024-12-15T10:00:00Z
   Relevance: 85.3%
...
```

### 3. Investment-Focused AI Analysis

Claude Sonnet 4.5 analyzes events with strict JSON output (see `backend/event-processor/analysis/promptTemplates.js`):

**System Prompt Philosophy**:
- Synthesize material events WITHOUT making investment recommendations
- Surface actionable insights for further investigation
- Connect dots between related events
- Assess confidence based on information completeness

**Output Schema**:
```json
{
  "summary": "Executive summary (2-3 sentences)",
  "key_insights": ["Insight 1", "Insight 2", ...],
  "impact_assessment": {
    "market_implications": "...",
    "financial_impact": "...",
    "strategic_significance": "..."
  },
  "related_context": "How this connects to similar events",
  "investigation_areas": ["Area 1", "Area 2"],
  "confidence_level": "HIGH|MEDIUM|LOW"
}
```

### 4. Alpha Vantage Timestamp Conversion

Alpha Vantage returns timestamps in `YYYYMMDDTHHmmss` format without timezone (see `backend/event-detector/sources/alphaVantage.js:56-75`). The system:

1. Parses compact format: `20251231T172712`
2. Determines EST/EDT offset based on US DSL rules
3. Converts to ISO 8601: `2025-12-31T17:27:12-05:00`

### 5. Batch DynamoDB Operations

User-event relationships created in batches of 25 (DynamoDB BatchWriteItem limit) - see `backend/event-detector/utils/userEventRelationships.js`.

## Environment Variables

### event-detector (.env)

```bash
AWS_REGION=us-east-1
ALPHA_VANTAGE_API_KEY=your_key
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789:portfolio-events
WATCHLIST=["TSLA","NVDA"]                        # Fallback if no users in DB
ALPHA_VANTAGE_QUERY_HOURS=6,10,13,16,20         # ET hours
ALPHA_VANTAGE_LOOKBACK_HOURS=6
QUERY_TIMEZONE=America/New_York
```

### event-processor (.env)

```bash
AWS_REGION=us-east-1
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PINECONE_API_KEY=your_key
PINECONE_INDEX_NAME=portfolio-events
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DASHBOARD_URL=https://your-dashboard.com          # Optional
```

## AWS Infrastructure Requirements

**DynamoDB Tables**: `portfolio-events`, `user-watchlists`, `user-events` (see README.md for schemas)
**S3 Bucket**: `portfolio-intelligence-reports-{region}-{account}`
**SNS Topic**: `portfolio-events` (Standard, not FIFO)
**EventBridge Rule**: Triggers event-detector on cron schedule
**IAM Role**: See `aws/lambda-trust-policy.json` and `aws/lambda-custom-policy.json`

## Runtime Configuration

**event-detector Lambda**:
- Runtime: Node.js 18.x
- Handler: `index.handler`
- Timeout: 5 minutes
- Memory: 512 MB

**event-processor Lambda**:
- Runtime: Custom (Bun layer or container)
- Handler: `index.handler`
- Timeout: 2 minutes
- Memory: 1024 MB
- Trigger: SNS topic subscription

## Performance Characteristics

- **Latency**: End-to-end < 2 seconds (avg)
  - Embedding: ~200ms
  - Pinecone query: ~50ms
  - Claude analysis: ~1200ms
  - Storage/notifications: ~300ms
- **Throughput**: 25-50 events/day (current), scales to 1000+/day
- **Cost**: ~$10-30/month (Claude API dominates)

## Code Organization

```
backend/
├── event-detector/              # Lambda 1: Event Detection (Node.js)
│   ├── sources/                 # API clients for Alpha Vantage, SEC EDGAR
│   ├── utils/                   # Deduplication, SNS, watchlists, ticker aggregation
│   ├── scripts/                 # Watchlist management, data migrations
│   └── index.js                 # Lambda handler
│
├── event-processor/             # Lambda 2: Event Processing (Bun)
│   ├── analysis/                # Claude client, prompt templates
│   ├── rag/                     # Embeddings, Pinecone, context builder
│   ├── storage/                 # DynamoDB, S3 clients
│   ├── notifications/           # Slack webhook
│   └── index.js                 # Lambda handler
│
├── backfill-events.js           # Historical data import (use bun)
└── test-pinecone.js             # Vector DB connectivity test (use bun)
```

## Important Notes

### Bun vs Node.js

**Prefer Bun for all new development work** unless constrained by AWS Lambda runtime requirements:
- `backend/event-processor/` uses Bun (preferred) - see its `CLAUDE.md` for Bun-specific APIs
- `backend/event-detector/` uses Node.js only because it runs on AWS Lambda Node.js 18.x runtime
- Root-level scripts (`backfill-events.js`, `test-pinecone.js`) should be run with `bun`

### Deduplication Strategy

Events are deduplicated using SHA-256 hash of `url + timestamp` (first 16 chars). This ensures:
- Same article from different sources = different events (different URLs)
- Re-published articles = different events (different timestamps)
- Atomic inserts with DynamoDB `ConditionExpression`

### SEC API Rate Limiting

SEC EDGAR requires 10 req/sec max with 100ms delays between requests (see `backend/event-detector/sources/secEdgar.js`). The code implements rate limiting with `setTimeout` loops.

### Data Migration Scripts

Several migration scripts exist in `backend/event-detector/scripts/`:
- `migrate-to-junction-table.js`: Migrates from old single-user to multi-user architecture
- `fix-malformed-timestamps.js`: Fixes legacy timestamp format issues
- `migrate-add-user-id.js`: Adds user_id field to events

These are historical tools - new code should use current architecture.
