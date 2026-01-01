import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function testPinecone() {
  try {
    console.log('Testing Pinecone connection...');
    
    const index = pinecone.index('portfolio-events');
    
    // Test upsert
    await index.upsert([{
      id: 'test-1',
      values: new Array(1536).fill(0.1),
      metadata: { test: 'true', ticker: 'TEST' }
    }]);
    
    console.log('✅ Upsert successful!');
    
    // Test query
    const results = await index.query({
      vector: new Array(1536).fill(0.1),
      topK: 1,
      includeMetadata: true
    });
    
    console.log('✅ Query successful!');
    console.log('Found:', results.matches.length, 'results');
    
    // Clean up test data
    await index.deleteOne('test-1');
    console.log('✅ Cleanup successful!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testPinecone();