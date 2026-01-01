import 'dotenv/config';

import { handler } from './index';

// Create a mock SNS event
const mockEvent = {
  Records: [{
    Sns: {
      Message: JSON.stringify({
        eventId: 'test-123',
        eventType: 'NEWS',
        ticker: 'TSLA',
        headline: 'Tesla announces new Gigafactory in Texas',
        url: 'https://example.com/news',
        sentiment: 0.65,
        timestamp: new Date().toISOString(),
        summary: 'Tesla announced plans to build a new manufacturing facility in Texas, expanding its production capacity significantly.'
      })
    }
  }]
};

async function test() {
  console.log('Testing Event Processor locally...\n');
  
  try {
    const result = await handler(mockEvent);
    console.log('\nResult:', result);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();