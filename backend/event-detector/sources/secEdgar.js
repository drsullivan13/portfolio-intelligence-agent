import axios from 'axios';
import xml2js from 'xml2js';

async function getSECFilings(tickers) {
  const filings = [];
  
  for (const ticker of tickers) {
    try {
      // SEC EDGAR RSS feed
      const response = await axios.get(
        `https://www.sec.gov/cgi-bin/browse-edgar`,
        {
          params: {
            action: 'getcompany',
            CIK: ticker, // Note: In production, you'd need CIK lookup
            type: '8-K',
            dateb: '',
            owner: 'exclude',
            count: 10,
            output: 'atom'
          },
          headers: {
            'User-Agent': 'Portfolio Intelligence Agent demo@example.com'
          }
        }
      );
      
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);
      
      if (result.feed && result.feed.entry) {
        for (const entry of result.feed.entry) {
          filings.push({
            ticker,
            formType: '8-K',
            accessionNumber: entry.id[0].split('accession-number=')[1],
            filingDate: entry.updated[0],
            url: entry.link[0].$.href
          });
        }
      }
    } catch (error) {
      console.error(`SEC filing fetch error for ${ticker}:`, error.message);
    }
  }
  
  return filings;
}

export { getSECFilings };