#!/bin/bash
echo "📦 Building deployment package for event-detector-backfill..."

# Install dependencies
npm install

# Create deployment package
zip -r event-detector-backfill.zip . -x "*.git*" -x "deploy-lambda.sh" -x "event-detector-backfill.zip"

echo "🚀 Updating Lambda function..."
aws lambda update-function-code \
  --function-name event-detector-backfill \
  --zip-file fileb://event-detector-backfill.zip

echo "✅ Deploy complete! Checking logs..."
sleep 2
aws logs tail /aws/lambda/event-detector-backfill --since 1m
