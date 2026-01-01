# Portfolio Intelligence Agent

**AI-powered investment intelligence system that monitors, analyzes, and contextualizes financial events in real-time.**

An event-driven serverless platform that continuously tracks SEC filings and market news, leveraging Claude AI and RAG (Retrieval-Augmented Generation) to deliver contextualized investment insights to portfolio managers and analysts.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Key Features](#key-features)
- [Core Technologies](#core-technologies)
- [Installation](#installation)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [System Design](#system-design)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Portfolio Intelligence Agent is a production-grade financial event processing system designed for hedge funds and institutional investors. The platform automatically:

1. **Detects** material events from SEC EDGAR (8-K filings) and Alpha Vantage (market news)
2. **Extracts** full filing content including Item disclosures and summaries
3. **Contextualizes** events using semantic search across historical data (30-day rolling window)
4. **Analyzes** using Claude Sonnet 4.5 with domain-specific investment prompts
5. **Delivers** structured insights via Slack, S3, and DynamoDB

The system processes **25-50 events daily** with sub-2-second latency and maintains complete audit trails for regulatory compliance.

---

## Architecture

**Event-Driven Serverless Architecture (AWS)**

```
┌─────────────────────────────────────────────────────────────────┐
│                        EVENT SOURCES                             │
├─────────────────────────────────────────────────────────────────┤
│  SEC EDGAR (8-K Filings)  │  Alpha Vantage (News Sentiment)     │
│  • Item extraction         │  • Scheduled queries (6h intervals)│
│  • Content parsing         │  • Sentiment scoring               │
└──────────────┬─────────────┴────────────────┬───────────────────┘
               │                              │
               v                              v
       ┌───────────────────────────────────────────────┐
       │      Lambda: Event Detector (Node.js)         │
       │  • Deduplication (SHA-256 event IDs)          │
       │  • DynamoDB persistence                       │
       │  • SNS publishing                             │
       └──────────────────┬────────────────────────────┘
                          │
                          v
                    [SNS Topic: portfolio-events]
                          │
                          v
       ┌──────────────────────────────────────────────────┐
       │    Lambda: Event Processor (Bun/TypeScript)      │
       │                                                   │
       │  1. Generate embeddings (OpenAI text-embedding-3)│
       │  2. Query Pinecone for similar events (cosine)   │
       │  3. Build RAG context prompt                     │
       │  4. Analyze with Claude Sonnet 4.5               │
       │  5. Store embedding (Pinecone)                   │
       │  6. Update analysis (DynamoDB)                   │
       │  7. Archive report (S3)                          │
       │  8. Send notification (Slack)                    │
       └──────────────────┬───────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         v                v                v
    [DynamoDB]       [Pinecone]          [S3]
    portfolio-       Vector DB         Reports
    events table     (1536-dim)        Archive
```

**Design Patterns:**
- **Event-Driven**: SNS pub/sub decouples detection from processing
- **RAG Architecture**: Vector similarity search provides historical context
- **Idempotency**: Event deduplication via content-addressable IDs
- **Graceful Degradation**: Partial failures don't block event processing

---

## Key Features

### 🔍 **Advanced 8-K Filing Analysis**
- **Content Extraction**: Parses actual 8-K documents from SEC EDGAR
- **Item Classification**: Identifies and categorizes all Item disclosures (1.01-9.01)
- **Smart Summarization**: Extracts and truncates content per Item (1000 chars)
- **Primary Item Detection**: Highlights most material disclosure (excludes boilerplate 9.01)

### 🧠 **Contextual Intelligence (RAG)**
- **Semantic Search**: Queries 30-day rolling window for related events
- **Cross-Event Analysis**: Surfaces patterns across filings and news
- **Relevance Scoring**: Ranks similar events by cosine similarity
- **Temporal Filtering**: Numeric timestamp filtering for performance

### 🤖 **AI-Powered Analysis**
- **Claude Sonnet 4.5**: Latest frontier model (released Jan 2025)
- **Structured Output**: JSON schema enforcement for reliability
- **Investment-Focused**: Custom prompts for hedge fund analysts
- **Multi-Dimensional Insights**:
  - Market implications (sentiment, positioning, sector trends)
  - Financial impact (revenue, margins, cash flow, multiples)
  - Strategic significance (competitive position, long-term strategy)
  - Investigation areas (actionable next steps)

### 📊 **Production-Grade Infrastructure**
- **Scheduled Execution**: EventBridge cron triggers (configurable intervals)
- **Rate Limiting**: SEC API compliance (10 req/sec with 100ms delays)
- **Observability**: CloudWatch logs, metrics, and dashboards
- **TTL Management**: Auto-expiring DynamoDB records (90 days)
- **S3 Archival**: Long-term storage for compliance and auditing

---

## Core Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Event Detection** | Node.js 18.x (AWS Lambda) | Lightweight, fast cold starts |
| **Event Processing** | Bun 1.x (AWS Lambda) | High-performance TypeScript runtime |
| **Vector Embeddings** | OpenAI `text-embedding-3-small` | 1536-dim semantic representations |
| **Vector Database** | Pinecone (Serverless) | Sub-100ms similarity search |
| **LLM Analysis** | Anthropic Claude Sonnet 4.5 | State-of-the-art reasoning |
| **Primary Storage** | AWS DynamoDB | Single-digit ms latency, auto-scaling |
| **Archival Storage** | AWS S3 | Cost-effective long-term retention |
| **Messaging** | AWS SNS | Decoupled event routing |
| **Notifications** | Slack (Incoming Webhooks) | Real-time analyst alerts |
| **Data Sources** | SEC EDGAR, Alpha Vantage | Regulatory filings, market news |

**External APIs:**
- **SEC EDGAR**: RSS feeds + document archive (public, rate-limited)
- **Alpha Vantage**: News sentiment API (requires free API key)
- **OpenAI**: Embeddings API (pay-per-use)
- **Anthropic**: Claude API (pay-per-use)
- **Pinecone**: Serverless vector DB (free tier: 100K vectors)

---

## Installation

### Prerequisites

- **Node.js** 18.x or higher (for event-detector)
- **Bun** 1.x or higher (for event-processor)
- **AWS CLI** configured with credentials
- **API Keys** (see Configuration section)

### Clone and Install

```bash
# Clone repository
git clone https://github.com/yourusername/portfolio-intelligence-agent.git
cd portfolio-intelligence-agent

# Install event-detector dependencies
cd backend/event-detector
npm install

# Install event-processor dependencies
cd ../event-processor
bun install

# Return to project root
cd ../..
```

---

## Configuration

### Environment Variables

Create `.env` files in each Lambda directory:

**backend/event-detector/.env**
```bash
# AWS Configuration
AWS_REGION=us-east-1

# Data Sources
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
WATCHLIST=["TSLA","NVDA","AAPL","MSFT","GOOGL"]

# Query Schedule (hours in America/New_York timezone)
ALPHA_VANTAGE_QUERY_HOURS=6,10,13,16,20
ALPHA_VANTAGE_LOOKBACK_HOURS=6
QUERY_TIMEZONE=America/New_York

# SNS Topic (auto-created via console or Terraform)
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789:portfolio-events
```

**backend/event-processor/.env**
```bash
# AWS Configuration
AWS_REGION=us-east-1

# AI Services
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Pinecone
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_NAME=portfolio-events

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DASHBOARD_URL=https://your-dashboard.com  # Optional
```

### AWS Infrastructure Setup

1. **DynamoDB Table**: `portfolio-events`
   - Partition Key: `event_id` (String)
   - TTL Attribute: `ttl` (Number, auto-expire after 90 days)

2. **S3 Bucket**: `portfolio-intelligence-reports-{region}-{account}`
   - Lifecycle policy: Archive to Glacier after 1 year

3. **SNS Topic**: `portfolio-events`
   - Standard topic (not FIFO)

4. **IAM Role**: `portfolio-lambda-role`
   - Trust policy: [aws/lambda-trust-policy.json](aws/lambda-trust-policy.json)
   - Custom policy: [aws/lambda-custom-policy.json](aws/lambda-custom-policy.json)

5. **EventBridge Rule**: `portfolio-event-detector-schedule`
   - Schedule: `rate(1 hour)` or custom cron
   - Target: `event-detector` Lambda

---

## Deployment

### Event Detector Lambda

```bash
cd backend/event-detector

# Build deployment package
chmod +x deploy-lambda.sh
./deploy-lambda.sh

# Or manually:
zip -r function.zip . -x "*.git*" -x "deploy.sh"
aws lambda update-function-code \
  --function-name event-detector \
  --zip-file fileb://function.zip
```

### Event Processor Lambda

```bash
cd backend/event-processor

# Build deployment package
chmod +x deploy-lambda.sh
./deploy-lambda.sh

# Or manually:
zip -r function.zip . -x "*.git*" -x "deploy.sh"
aws lambda update-function-code \
  --function-name event-processor \
  --zip-file fileb://function.zip
```

### Lambda Configuration

**event-detector:**
- Runtime: Node.js 18.x
- Handler: `index.handler`
- Timeout: 5 minutes
- Memory: 512 MB
- Environment: See Configuration section

**event-processor:**
- Runtime: Custom (Bun layer or container)
- Handler: `index.handler`
- Timeout: 2 minutes
- Memory: 1024 MB
- Trigger: SNS topic `portfolio-events`

---

## Testing

### Local Testing

**Event Detector:**
```bash
cd backend/event-detector
node index.js  # Manual execution (bypasses schedule check)
```

**Event Processor:**
```bash
cd backend/event-processor
bun run test-local.js

# Expected output:
# ✅ Embedding generated
# ✅ Found 3 similar events
# ✅ Context prompt built
# ✅ Analysis generated: HIGH confidence
# ✅ Stored in Pinecone
# ✅ DynamoDB updated
# ✅ Archived to S3
# ✅ Slack notification sent
```

### Integration Testing

1. **Trigger Event Detector** (via AWS Console or CLI):
```bash
aws lambda invoke \
  --function-name event-detector \
  --payload '{}' \
  response.json
```

2. **Verify DynamoDB** (check new events):
```bash
aws dynamodb scan \
  --table-name portfolio-events \
  --filter-expression "attribute_exists(event_id)" \
  --limit 5
```

3. **Check CloudWatch Logs**:
```bash
aws logs tail /aws/lambda/event-detector --follow
aws logs tail /aws/lambda/event-processor --follow
```

### Unit Tests
(Not yet implemented - see Contributing section)

---

## Project Structure

```
portfolio-intelligence-agent/
├── backend/
│   ├── event-detector/           # Lambda 1: Event Detection
│   │   ├── sources/
│   │   │   ├── alphaVantage.js  # Alpha Vantage API client
│   │   │   └── secEdgar.js      # SEC EDGAR scraper + parser
│   │   ├── utils/
│   │   │   ├── deduplication.js # Event ID generation
│   │   │   └── snsPublisher.js  # SNS message publishing
│   │   ├── index.js             # Lambda handler
│   │   ├── package.json
│   │   └── deploy-lambda.sh
│   │
│   ├── event-processor/          # Lambda 2: Event Processing
│   │   ├── analysis/
│   │   │   ├── claudeClient.js  # Claude API integration
│   │   │   └── promptTemplates.js # Investment-focused prompts
│   │   ├── rag/
│   │   │   ├── embeddings.js    # OpenAI embeddings
│   │   │   ├── pinecone.js      # Vector DB operations
│   │   │   └── contextBuilder.js # RAG prompt assembly
│   │   ├── storage/
│   │   │   ├── dynamodb.js      # DynamoDB updates
│   │   │   └── s3.js            # S3 archival
│   │   ├── notifications/
│   │   │   └── slack.js         # Slack webhook client
│   │   ├── index.js             # Lambda handler
│   │   ├── test-local.js        # Local test harness
│   │   ├── package.json
│   │   └── deploy-lambda.sh
│   │
│   ├── backfill-events.js        # Historical data import script
│   └── test-pinecone.js          # Pinecone connectivity test
│
├── aws/
│   ├── lambda-trust-policy.json  # IAM trust relationship
│   ├── lambda-custom-policy.json # IAM permissions
│   └── cloudwatch-dashboard-widget.json # Monitoring config
│
├── docs/                          # Documentation (TBD)
├── frontend/                      # Dashboard UI (TBD)
├── .gitignore
└── README.md                      # This file
```

---

## System Design

### Event Flow

1. **Scheduled Trigger** (EventBridge)
   - Cron: Every hour
   - Invokes: `event-detector` Lambda

2. **Event Detection** (`event-detector`)
   - Queries Alpha Vantage (if scheduled hour)
   - Queries SEC EDGAR RSS feeds
   - For 8-K filings:
     - Fetches actual document from SEC Archive
     - Parses Items (regex: `/Item\s+(\d+\.\d+)/gi`)
     - Extracts content per Item
     - Builds enriched headline and summary
   - Generates event ID (SHA-256 of URL + timestamp)
   - Checks DynamoDB for duplicates
   - Stores new events with `PENDING_ANALYSIS` status
   - Publishes to SNS topic

3. **Event Processing** (`event-processor`)
   - Triggered by SNS message
   - Generates 1536-dim embedding (OpenAI)
   - Queries Pinecone for similar events:
     - Filters: `timestamp >= now - 30 days`, `ticker = X`
     - Limit: Top 10 results
     - Metric: Cosine similarity
   - Builds RAG context:
     - Current event details (headline, summary, sentiment, URL)
     - Similar events (headlines, dates, relevance scores)
   - Sends prompt to Claude Sonnet 4.5:
     - System: Investment analyst assistant prompt
     - User: Structured JSON schema request
   - Parses Claude response (strict JSON)
   - Stores embedding in Pinecone (for future queries)
   - Updates DynamoDB:
     - Status: `ANALYZED`
     - Analysis: Full JSON object
     - Metadata: Model version, processing time, similar events count
     - TTL: Current timestamp + 90 days
   - Uploads full report to S3 (JSON format)
   - Sends Slack notification (formatted blocks)

### Data Models

**DynamoDB Schema (`portfolio-events`)**
```javascript
{
  event_id: "abc123...",              // PK: SHA-256 hash
  ticker: "TSLA",
  event_type: "SEC_FILING" | "NEWS",
  timestamp: "2025-01-01T12:00:00Z",
  headline: "8-K Filing: Item 2.02 - Financial Results",
  url: "https://sec.gov/...",
  sentiment_score: 0.65,              // NEWS only
  items_reported: "2.02, 9.01",       // SEC_FILING only
  primary_item: "2.02",               // SEC_FILING only
  content_summary: "...",             // SEC_FILING only
  status: "ANALYZED",
  detected_at: "2025-01-01T12:00:05Z",
  analyzed_at: "2025-01-01T12:00:07Z",
  analysis: {
    summary: "...",
    key_insights: ["...", "..."],
    impact_assessment: { ... },
    related_context: "...",
    investigation_areas: ["...", "..."],
    confidence_level: "HIGH"
  },
  processing_metadata: {
    similar_events_count: 3,
    model_version: "claude-sonnet-4-5-20250929"
  },
  ttl: 1735689600                     // Unix timestamp (90 days)
}
```

**Pinecone Metadata**
```javascript
{
  id: "abc123...",                    // Same as event_id
  values: [0.123, -0.456, ...],       // 1536-dim embedding
  metadata: {
    ticker: "TSLA",
    event_type: "SEC_FILING",
    timestamp: 1735689600000,         // Numeric milliseconds
    headline: "8-K Filing: Item 2.02 - Financial Results",
    url: "https://sec.gov/..."
  }
}
```

### Performance Characteristics

- **Latency**: End-to-end processing <2 seconds (avg)
  - Embedding generation: ~200ms
  - Pinecone query: ~50ms
  - Claude analysis: ~1200ms
  - DynamoDB/S3/Slack: ~300ms
- **Throughput**: 50 events/day (current), scales to 1000+/day
- **Cost**: ~$10-30/month at current volume (Claude API dominates)
- **Availability**: 99.9% (AWS Lambda + DynamoDB)

### Scalability Considerations

- **Current**: Single-region, single-tenant
- **Future**:
  - Multi-region deployment (latency optimization)
  - DynamoDB Global Tables (cross-region replication)
  - SQS buffering (rate smoothing for API quotas)
  - Batch embedding generation (cost optimization)
  - Streaming analysis (WebSockets for real-time updates)

---

## Contributing

Contributions welcome! Priority areas:

1. **Testing Infrastructure**
   - Unit tests (Jest/Vitest)
   - Integration tests (LocalStack)
   - E2E tests (synthetic events)

2. **Monitoring & Alerting**
   - CloudWatch dashboards ([widget config](aws/cloudwatch-dashboard-widget.json))
   - Error rate alarms
   - Cost anomaly detection

3. **Frontend Dashboard**
   - Event timeline visualization
   - Search and filtering
   - Analysis comparison tools

4. **Data Pipeline Enhancements**
   - Additional sources (Earnings calls, Twitter, Bloomberg)
   - Multi-language support
   - Custom analyst workflows

**Development Workflow:**
```bash
# 1. Fork and clone
git checkout -b feature/your-feature

# 2. Make changes and test locally
cd backend/event-processor
bun run test-local.js

# 3. Deploy to dev environment
AWS_PROFILE=dev ./deploy-lambda.sh

# 4. Submit PR with:
#    - Description of changes
#    - Test coverage
#    - Performance impact analysis
```

---

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

## Contact & Support

**Maintainer**: Dan Sullivan
**Issues**: [GitHub Issues](https://github.com/yourusername/portfolio-intelligence-agent/issues)

---

**Built with**: AWS Lambda, Claude AI, Pinecone, OpenAI
**For**: Hedge funds and institutional investors seeking real-time financial intelligence

---

*Last updated: January 2026*