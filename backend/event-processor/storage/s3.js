import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

async function uploadToS3(eventId, eventData, analysis) {
  try {
    console.log(`Uploading report to S3 for event ${eventId}...`);
    
    const report = {
      event: eventData,
      analysis,
      generated_at: new Date().toISOString()
    };
    
    const ticker = eventData.ticker;
    const date = new Date(eventData.timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    const key = `reports/${ticker}/${year}/${month}/${eventId}.json`;
    
    const command = new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(report, null, 2),
      ContentType: 'application/json',
      Metadata: {
        ticker: ticker,
        event_type: eventData.eventType,
        analyzed_at: new Date().toISOString()
      }
    });
    
    await s3.send(command);
    console.log(`✅ Report uploaded to S3: ${key}`);
    
    return key;
  } catch (error) {
    console.error('Error uploading to S3:', error.message);
    // Don't throw - S3 storage is nice to have but not critical
  }
}

export { uploadToS3 };