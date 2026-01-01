# deploy.sh
#!/bin/bash
echo "📦 Building deployment package..."
zip -r function.zip . -x "*.git*" -x "test-*.js" -x "*.env"

echo "🚀 Updating Lambda function..."
aws lambda update-function-code \
  --function-name event-processor \
  --zip-file fileb://function.zip

echo "✅ Deploy complete! Checking logs..."
sleep 2
aws logs tail /aws/lambda/event-processor --since 1m