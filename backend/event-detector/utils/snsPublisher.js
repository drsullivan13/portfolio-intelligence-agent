import { PublishCommand } from '@aws-sdk/client-sns';

async function publishToSNS(snsClient, eventData) {
  const message = {
    eventId: eventData.eventId,
    eventType: eventData.eventType,
    ticker: eventData.ticker,
    headline: eventData.headline,
    url: eventData.url,
    timestamp: eventData.timestamp,
    ...(eventData.sentiment && { sentiment: eventData.sentiment }),
    ...(eventData.summary && { summary: eventData.summary }),
    ...(eventData.formType && { formType: eventData.formType }),
    ...(eventData.filingDate && { filingDate: eventData.filingDate })
  };
  
  await snsClient.send(new PublishCommand({
    TopicArn: process.env.SNS_TOPIC_ARN,
    Message: JSON.stringify(message),
    Subject: `New ${eventData.eventType} Event: ${eventData.ticker}`
  }));
  
  console.log(`Published event ${eventData.eventId} to SNS`);
}

export { publishToSNS };