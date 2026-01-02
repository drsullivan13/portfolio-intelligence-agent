import axios from 'axios';
import * as cheerio from 'cheerio';

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

// Cache for ticker to CIK mapping
let tickerCIKCache = null;

// Headers for SEC API requests
const SEC_HEADERS = {
  'User-Agent': 'Portfolio Intelligence Agent demo@example.com',
  'Accept-Encoding': 'gzip, deflate',
  'Host': 'www.sec.gov'
};

// Pad CIK to 10 digits with leading zeros
function padCIK(cik) {
  return cik.toString().padStart(10, '0');
}

// Fetch ticker to CIK mapping from SEC
async function fetchTickerToCIKMapping() {
  if (tickerCIKCache) {
    return tickerCIKCache;
  }

  try {
    const response = await axios.get('https://www.sec.gov/files/company_tickers.json', {
      headers: SEC_HEADERS,
      timeout: 10000
    });

    // Convert to Map: ticker -> CIK
    const mapping = new Map();
    Object.values(response.data).forEach(company => {
      const ticker = company.ticker.toUpperCase();
      const cik = padCIK(company.cik_str);
      mapping.set(ticker, cik);
    });

    tickerCIKCache = mapping;
    console.log(`Loaded ${mapping.size} ticker-to-CIK mappings`);
    return mapping;
  } catch (error) {
    console.error('Failed to fetch ticker-to-CIK mapping:', error.message);
    return new Map();
  }
}

// Fetch submissions data from SEC for a given CIK
async function fetchSubmissionsData(cik) {
  try {
    const paddedCIK = padCIK(cik);
    const url = `https://data.sec.gov/submissions/CIK${paddedCIK}.json`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Portfolio Intelligence Agent demo@example.com',
        'Accept-Encoding': 'gzip, deflate'
      },
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch submissions for CIK ${cik}: ${error.message}`);
  }
}

// Extract recent 8-K filings from submissions data
function extractRecent8Ks(submissionsData, lookbackDays = 30) {
  const filings = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  if (!submissionsData.filings || !submissionsData.filings.recent) {
    return filings;
  }

  const recent = submissionsData.filings.recent;
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  const accessionNumbers = recent.accessionNumber || [];
  const primaryDocuments = recent.primaryDocument || [];

  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '8-K') {
      const filingDate = new Date(filingDates[i]);

      if (filingDate >= cutoffDate) {
        filings.push({
          formType: '8-K',
          accessionNumber: accessionNumbers[i],
          filingDate: filingDate.toISOString(),
          primaryDocument: primaryDocuments[i]
        });
      }
    }
  }

  return filings;
}

// Build SEC Archive URL for a document
function buildDocumentURL(cik, accessionNumber, filename) {
  const accessionWithoutDashes = accessionNumber.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionWithoutDashes}/${filename}`;
}

// Fetch filing index page
async function fetchFilingIndex(cik, accessionNumber) {
  try {
    const accessionWithoutDashes = accessionNumber.replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionWithoutDashes}/${accessionNumber}-index.htm`;

    const response = await axios.get(url, {
      headers: SEC_HEADERS,
      timeout: 10000
    });

    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch filing index: ${error.message}`);
  }
}

// Parse filing index to extract document links
function parseFilingDocuments(indexHtml) {
  const $ = cheerio.load(indexHtml);
  const documents = {
    primaryDoc: null,
    exhibit991: null,
    exhibit99: null
  };

  // Find the documents table
  $('table tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 3) {
      const type = $(cells[3]).text().trim(); // Type column
      const documentLink = $(cells[2]).find('a').attr('href'); // Document column

      if (documentLink) {
        const filename = documentLink.split('/').pop();

        // Look for exhibits first (higher priority)
        if (type === 'EX-99.1' || filename.toLowerCase().includes('ex99') || filename.toLowerCase().includes('exhibit99')) {
          if (!documents.exhibit991) {
            documents.exhibit991 = filename;
          }
        } else if (type === 'EX-99') {
          if (!documents.exhibit99) {
            documents.exhibit99 = filename;
          }
        } else if (type === '8-K' || type.includes('8-K')) {
          if (!documents.primaryDoc) {
            documents.primaryDoc = filename;
          }
        }
      }
    }
  });

  // If no primary document found, try to get the first .htm file
  if (!documents.primaryDoc) {
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 3) {
        const documentLink = $(cells[2]).find('a').attr('href');
        if (documentLink && documentLink.endsWith('.htm')) {
          const filename = documentLink.split('/').pop();
          if (!filename.includes('index')) {
            documents.primaryDoc = filename;
            return false; // break
          }
        }
      }
    });
  }

  return documents;
}

// Fetch document content
async function fetchDocument(url) {
  try {
    const response = await axios.get(url, {
      headers: SEC_HEADERS,
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    throw new Error(`Failed to fetch document: ${error.message}`);
  }
}

// Parse exhibit content (e.g., EX-99.1 press releases)
function parseExhibitContent(htmlContent) {
  const $ = cheerio.load(htmlContent);

  // Extract headline from title or first heading
  let headline = $('title').text().trim();
  if (!headline || headline.toLowerCase().includes('exhibit')) {
    headline = $('h1').first().text().trim() ||
               $('b').first().text().trim() ||
               'Press Release';
  }

  // Remove common noise from headline
  headline = headline
    .replace(/^Exhibit\s+\d+(\.\d+)?/i, '')
    .replace(/^EX-\d+(\.\d+)?/i, '')
    .trim();

  // Extract body content
  // Remove script, style, and other non-content elements
  $('script, style, meta, link').remove();

  // Get text content from body or main container
  let content = $('body').text() || $.text();

  // Clean up whitespace
  content = content
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to reasonable length (5000 chars for exhibits)
  if (content.length > 5000) {
    content = content.substring(0, 5000) + '...';
  }

  return { headline, content };
}

// Parse 8-K Items and content from primary document
function parseItemsFrom8K(htmlContent) {
  const $ = cheerio.load(htmlContent);
  const items = [];
  const content = {};

  // Remove script, style elements
  $('script, style, meta, link').remove();

  // Get all text content
  const fullText = $('body').text() || $.text();
  const cleanText = fullText.replace(/\s+/g, ' ');

  // Find all Item markers (e.g., "Item 2.02", "Item 5.02")
  const itemRegex = /Item\s+(\d+\.\d+)/gi;
  const matches = [...cleanText.matchAll(itemRegex)];

  matches.forEach((match, index) => {
    const itemNumber = match[1];
    items.push(itemNumber);

    // Extract content between this Item and the next Item (or end)
    const startPos = match.index + match[0].length;
    const endPos = index < matches.length - 1 ? matches[index + 1].index : cleanText.length;
    const itemText = cleanText.substring(startPos, endPos).trim();

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

  // Truncate to reasonable length (1000 chars per item)
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
async function enrichFilingWithContent(filing, cik) {
  try {
    console.log(`Enriching ${filing.accessionNumber}...`);

    // Step 1: Fetch the filing index page to get document list
    const indexHtml = await fetchFilingIndex(cik, filing.accessionNumber);

    // Step 2: Parse index to find documents
    const documents = parseFilingDocuments(indexHtml);
    console.log(`Found documents:`, documents);

    let headline = null;
    let summary = null;
    let items = [];
    let primaryItem = null;
    let contentSource = 'metadata';
    let exhibitType = null;

    // Step 3: Try to fetch and parse EX-99.1 first (priority)
    if (documents.exhibit991) {
      try {
        const exhibitURL = buildDocumentURL(cik, filing.accessionNumber, documents.exhibit991);
        console.log(`Fetching exhibit from: ${exhibitURL}`);
        const exhibitHtml = await fetchDocument(exhibitURL);
        const parsed = parseExhibitContent(exhibitHtml);

        headline = parsed.headline;
        summary = parsed.content;
        contentSource = 'exhibit';
        exhibitType = 'EX-99.1';
        items = ['9.01']; // Exhibits are typically under Item 9.01
        primaryItem = '9.01';

        console.log(`Successfully extracted content from EX-99.1`);
      } catch (error) {
        console.log(`Failed to parse EX-99.1, falling back to primary document:`, error.message);
      }
    }

    // Step 4: Fallback to primary 8-K document if no exhibit or exhibit failed
    if (!summary && documents.primaryDoc) {
      try {
        const primaryURL = buildDocumentURL(cik, filing.accessionNumber, documents.primaryDoc);
        console.log(`Fetching primary document from: ${primaryURL}`);
        const primaryHtml = await fetchDocument(primaryURL);
        const parsed = parseItemsFrom8K(primaryHtml);

        if (parsed.items.length > 0) {
          items = parsed.items;

          // Find primary item (first non-9.01 item, or first item)
          primaryItem = items.find(item => item !== '9.01') || items[0];

          // Summarize each Item
          const itemSummaries = items.map(item =>
            summarizeItemContent(item, parsed.content[item] || '')
          );

          // Build headline
          headline = `8-K Filing: Item ${primaryItem} - ${ITEM_DESCRIPTIONS[primaryItem] || 'Other'}`;

          // Build combined summary
          summary = itemSummaries
            .map(s => `Item ${s.item} (${s.description}): ${s.content}`)
            .join('\n\n');

          contentSource = 'primary';

          console.log(`Successfully extracted content from primary document`);
        }
      } catch (error) {
        console.log(`Failed to parse primary document:`, error.message);
      }
    }

    // Step 5: Return enriched filing
    if (summary) {
      return {
        ...filing,
        items,
        primaryItem,
        headline,
        summary,
        contentSource,
        exhibitType
      };
    } else {
      // Return basic filing if all parsing failed
      console.log(`No content extracted for ${filing.accessionNumber}`);
      return filing;
    }

  } catch (error) {
    console.error(`Content enrichment failed for ${filing.accessionNumber}:`, error.message);
    return filing;
  }
}

// Main function to get SEC filings
async function getSECFilings(tickers) {
  const filings = [];

  try {
    // Fetch ticker to CIK mapping once
    const tickerCIKMap = await fetchTickerToCIKMapping();

    for (const ticker of tickers) {
      try {
        // Get CIK for ticker
        const cik = tickerCIKMap.get(ticker.toUpperCase());

        if (!cik) {
          console.error(`CIK not found for ticker: ${ticker}`);
          continue;
        }

        console.log(`Fetching 8-K filings for ${ticker} (CIK: ${cik})...`);

        // Fetch submissions data
        const submissionsData = await fetchSubmissionsData(cik);

        // Extract recent 8-K filings
        const recent8Ks = extractRecent8Ks(submissionsData, 30);
        console.log(`Found ${recent8Ks.length} recent 8-K filings for ${ticker}`);

        // Enrich each filing with content
        for (const filing of recent8Ks) {
          try {
            // Add ticker and URL to filing object
            filing.ticker = ticker;
            filing.url = `https://www.sec.gov/Archives/edgar/data/${cik}/${filing.accessionNumber.replace(/-/g, '')}/${filing.accessionNumber}-index.htm`;

            // Enrich with content
            const enrichedFiling = await enrichFilingWithContent(filing, cik);
            filings.push(enrichedFiling);

            // Rate limiting: 100ms delay between requests (allows ~10 req/sec)
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`Failed to enrich ${filing.accessionNumber}:`, error.message);
            // Include basic filing even if enrichment fails
            filings.push(filing);
          }
        }

      } catch (error) {
        console.error(`SEC filing fetch error for ${ticker}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`SEC filing fetch error:`, error.message);
  }

  return filings;
}

export { getSECFilings };
