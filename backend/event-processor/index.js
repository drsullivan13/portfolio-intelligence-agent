import { generateEmbedding } from './rag/embeddings.js';
import { queryPinecone, upsertToPinecone } from './rag/pinecone.js';
import { buildContextPrompt } from './rag/contextBuilder.js';
import { analyzeWithClaude } from './analysis/claudeClient.js';
import { updateDynamoDB } from './storage/dynamodb.js';
import { uploadToS3 } from './storage/s3.js';
import { sendSlackNotification } from './notifications/slack.js';

export const handler = async (event) => {
  console.log('='.repeat(80));
  console.log('EVENT PROCESSOR LAMBDA STARTED');
  console.log('='.repeat(80));
  
  try {
    // Parse SNS message
    const snsRecord = event.Records[0];
    const snsMessage = JSON.parse(snsRecord.Sns.Message);

    // NEW: userIds is now an array (not single userId)
    const userIds = snsMessage.userIds || [];

    console.log('Processing event:', snsMessage.eventId);
    console.log('Ticker:', snsMessage.ticker);
    console.log('Type:', snsMessage.eventType);
    console.log('Watchers:', userIds.join(', '));
    
    const startTime = Date.now();
    
    // Step 1: Generate embedding for current event
    console.log('\n--- STEP 1: Generate Embedding ---');
    const eventText = buildEventText(snsMessage);
    const embedding = await generateEmbedding(eventText);
    
    // Step 2: Query Pinecone for similar events
    console.log('\n--- STEP 2: Query Vector Store ---');
    const similarEvents = await queryPinecone(embedding, snsMessage.ticker);
    
    // Step 3: Build context prompt
    console.log('\n--- STEP 3: Build Context ---');
    const contextPrompt = buildContextPrompt(snsMessage, similarEvents);
    
    // Step 4: Analyze with Claude
    console.log('\n--- STEP 4: AI Analysis ---');
    const analysis = await analyzeWithClaude(contextPrompt);
    
    console.log('Analysis generated:');
    console.log('- Confidence:', analysis.confidence_level);
    console.log('- Insights:', analysis.key_insights.length);
    
    // Step 5: Store embedding in Pinecone
    console.log('\n--- STEP 5: Store in Vector DB ---');
    await upsertToPinecone(snsMessage.eventId, embedding, {
      ticker: snsMessage.ticker,
      event_type: snsMessage.eventType,
      timestamp: snsMessage.timestamp,
      headline: snsMessage.headline,
      url: snsMessage.url
    });
    
    // Step 6: Update DynamoDB with analysis
    console.log('\n--- STEP 6: Update DynamoDB ---');
    await updateDynamoDB(snsMessage.eventId, analysis, similarEvents.length);
    
    // Step 7: Upload full report to S3
    console.log('\n--- STEP 7: Archive to S3 ---');
    await uploadToS3(snsMessage.eventId, snsMessage, analysis);
    
    // Step 8: Send Slack notification
    console.log('\n--- STEP 8: Send Notification ---');
    await sendSlackNotification(snsMessage, analysis);
    
    const processingTime = Date.now() - startTime;
    console.log('\n' + '='.repeat(80));
    console.log(`✅ EVENT PROCESSED SUCCESSFULLY in ${processingTime}ms`);
    console.log('='.repeat(80));
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Event processed successfully',
        eventId: snsMessage.eventId,
        processingTime
      })
    };
    
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ ERROR PROCESSING EVENT');
    console.error('='.repeat(80));
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Don't throw - we want to log the error but not retry
    // (most errors are not transient)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message
      })
    };
  }
};

function buildEventText(event) {
  let text = `${event.ticker} - ${event.headline}`;
  if (event.summary) {
    text += `: ${event.summary}`;
  }
  return text;
}