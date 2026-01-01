import axios from 'axios';
import xml2js from 'xml2js';

// Map 8-K Item numbers to human-readable descriptions
const ITEM_DESCRIPTIONS = {
  '1.01': 'Material Agreement',
  '1.02': 'Termination of Material Agreement',
  '1.03': 'Bankruptcy or Receivership',
  '2.01': 'Acquisition or Disposition',
  '2.02': 'Financial Results',
  '2.03': 'Creation of Direct Financial Obligation',
  '2.04': 'Triggering Event Accelerating Obligation',
  '2.05': 'Costs of Exit or Disposal Activities',
  '2.06': 'Material Impairments',
  '3.01': 'Notice of Delisting',
  '3.02': 'Unregistered Sales of Equity',
  '3.03': 'Material Modification to Rights',
  '4.01': 'Changes in Certifying Accountant',
  '4.02': 'Non-Reliance on Prior Financial Statements',
  '5.01': 'Changes in Control',
  '5.02': 'Officer/Director Changes',
  '5.03': 'Amendments to Charter/Bylaws',
  '5.04': 'Temporary Suspension of Trading',
  '5.05': 'Amendment to Code of Ethics',
  '5.06': 'Change in Shell Status',
  '5.07': 'Submission to Vote of Security Holders',
  '5.08': 'Shareholder Director Nominations',
  '6.01': 'ABS Informational Material',
  '6.02': 'ABS Servicer Compliance',
  '6.03': 'ABS Change in Credit Enhancement',
  '6.04': 'Failure to Make Required Distribution',
  '6.05': 'Securities Act Updating Disclosure',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Material Events',
  '9.01': 'Financial Statements and Exhibits'
};

// Extract CIK from accession number (first 10 digits)
function parseCIKFromAccession(accessionNumber) {
  const cik = accessionNumber.split('-')[0];
  return cik;
}

// Build SEC Archive URL for 8-K document
function buildDocumentURL(cik, accessionNumber) {
  const accessionWithoutDashes = accessionNumber.replace(/-/g, '');
  // Try the primary document (typically same name as accession number)
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionWithoutDashes}/${accessionNumber}.htm`;
}

// Fetch actual 8-K document content
async function fetch8KContent(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Portfolio Intelligence Agent demo@example.com'
      },
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch 8-K document: ${error.message}`);
  }
}

// Parse 8-K HTML to extract Items and content
function parseItemsFrom8K(htmlContent) {
  const items = [];
  const content = {};

  // Remove HTML tags for easier parsing
  const textContent = htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  // Find all Item markers (e.g., "Item 2.02", "Item 5.02")
  const itemRegex = /Item\s+(\d+\.\d+)/gi;
  const matches = [...textContent.matchAll(itemRegex)];

  matches.forEach((match, index) => {
    const itemNumber = match[1];
    items.push(itemNumber);

    // Extract content between this Item and the next Item (or end)
    const startPos = match.index + match[0].length;
    const endPos = index < matches.length - 1 ? matches[index + 1].index : textContent.length;
    const itemText = textContent.substring(startPos, endPos).trim();

    content[itemNumber] = itemText;
  });

  return { items, content };
}

// Summarize Item content with description and truncated text
function summarizeItemContent(itemNumber, content) {
  const description = ITEM_DESCRIPTIONS[itemNumber] || 'Other';

  // Clean up the content
  let cleanContent = content
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to reasonable length (1000 chars)
  if (cleanContent.length > 1000) {
    cleanContent = cleanContent.substring(0, 1000) + '...';
  }

  return {
    item: itemNumber,
    description,
    content: cleanContent
  };
}

// Enrich filing with actual content
async function enrichFilingWithContent(filing) {
  try {
    console.log(`Fetching content for ${filing.accessionNumber}...`);

    // Build document URL
    const cik = parseCIKFromAccession(filing.accessionNumber);
    const documentURL = buildDocumentURL(cik, filing.accessionNumber);

    // Fetch the document
    const htmlContent = await fetch8KContent(documentURL);

    // Parse Items and content
    const { items, content } = parseItemsFrom8K(htmlContent);

    if (items.length === 0) {
      console.log(`No items found in ${filing.accessionNumber}, using basic metadata`);
      return filing;
    }

    // Summarize each Item
    const itemSummaries = items.map(item => summarizeItemContent(item, content[item]));

    // Find primary item (first non-9.01 item, or first item)
    const primaryItem = items.find(item => item !== '9.01') || items[0];
    const primarySummary = itemSummaries.find(s => s.item === primaryItem);

    // Build headline
    const headline = `8-K Filing: Item ${primaryItem} - ${ITEM_DESCRIPTIONS[primaryItem] || 'Other'}`;

    // Build combined summary
    const summary = itemSummaries
      .map(s => `Item ${s.item} (${s.description}): ${s.content}`)
      .join('\n\n');

    return {
      ...filing,
      items,
      primaryItem,
      headline,
      summary
    };
  } catch (error) {
    console.error(`Content enrichment failed for ${filing.accessionNumber}:`, error.message);
    // Return original filing if enrichment fails
    return filing;
  }
}

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
        // First, collect basic filing metadata from RSS feed
        const basicFilings = [];
        for (const entry of result.feed.entry) {
          basicFilings.push({
            ticker,
            formType: '8-K',
            accessionNumber: entry.id[0].split('accession-number=')[1],
            filingDate: entry.updated[0],
            url: entry.link[0].$.href
          });
        }

        // Then enrich each filing with actual content
        for (const filing of basicFilings) {
          try {
            const enrichedFiling = await enrichFilingWithContent(filing);
            filings.push(enrichedFiling);

            // Rate limiting: 100ms delay between requests (allows ~10 req/sec)
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`Failed to enrich ${filing.accessionNumber}:`, error.message);
            // Fallback: include basic filing without content
            filings.push(filing);
          }
        }
      }
    } catch (error) {
      console.error(`SEC filing fetch error for ${ticker}:`, error.message);
    }
  }
  
  return filings;
}

export { getSECFilings };