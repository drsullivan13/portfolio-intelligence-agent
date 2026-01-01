import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const indexName = process.env.PINECONE_INDEX_NAME || 'portfolio-events';
const index = pinecone.index(indexName);

async function queryPinecone(embedding, ticker) {
  try {
    console.log(`Querying Pinecone for similar events (ticker: ${ticker})`);
    
    // Get events from last 30 days
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    const results = await index.query({
      vector: embedding,
      topK: 10,
      includeMetadata: true,
      filter: {
        timestamp: { $gte: thirtyDaysAgo }
      }
    });
    
    console.log(`✅ Found ${results.matches.length} similar events`);
    
    return results.matches.map(match => ({
      score: match.score,
      ...match.metadata
    }));
  } catch (error) {
    console.error('Error querying Pinecone:', error.message);
    // Return empty array on error - don't fail the whole pipeline
    return [];
  }
}

async function upsertToPinecone(eventId, embedding, metadata) {
  try {
    console.log(`Upserting event ${eventId} to Pinecone`);

    await index.upsert([{
      id: eventId,
      values: embedding,
      metadata: {
        ...metadata,
        // Convert timestamp to number for filtering
        timestamp: new Date(metadata.timestamp).getTime()
      }
    }]);
    
    console.log('✅ Event added to Pinecone vector store');
  } catch (error) {
    console.error('Error upserting to Pinecone:', error.message);
    // Don't throw - this is not critical to pipeline
  }
}

export { queryPinecone, upsertToPinecone };