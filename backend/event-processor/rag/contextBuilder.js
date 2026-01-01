function buildContextPrompt(currentEvent, similarEvents) {
    console.log('Building context prompt...');
    
    let contextString = `CURRENT EVENT:\n`;
    contextString += `Type: ${currentEvent.eventType}\n`;
    contextString += `Ticker: ${currentEvent.ticker}\n`;
    contextString += `Headline: ${currentEvent.headline}\n`;
    contextString += `Date: ${currentEvent.timestamp}\n`;
    contextString += `URL: ${currentEvent.url}\n`;
    
    if (currentEvent.sentiment !== undefined) {
      const sentimentLabel = currentEvent.sentiment > 0.2 ? 'Positive' :
                            currentEvent.sentiment < -0.2 ? 'Negative' : 'Neutral';
      contextString += `Sentiment: ${sentimentLabel} (${currentEvent.sentiment.toFixed(2)})\n`;
    }
    
    if (currentEvent.summary) {
      contextString += `\nSummary: ${currentEvent.summary}\n`;
    }
    
    if (similarEvents.length > 0) {
      contextString += `\n\nRECENT RELATED CONTEXT (${similarEvents.length} similar events):\n`;
      
      // Sort by relevance score
      const sortedEvents = similarEvents.sort((a, b) => b.score - a.score);
      
      sortedEvents.forEach((event, idx) => {
        contextString += `\n${idx + 1}. [${event.ticker}] ${event.headline}\n`;
        contextString += `   Date: ${event.timestamp}\n`;
        contextString += `   Type: ${event.event_type}\n`;
        contextString += `   Relevance: ${(event.score * 100).toFixed(1)}%\n`;
      });
    } else {
      contextString += `\n\nNOTE: No recent related events found in the last 30 days.\n`;
    }
    
    console.log('✅ Context prompt built');
    return contextString;
  }
  
  export { buildContextPrompt };