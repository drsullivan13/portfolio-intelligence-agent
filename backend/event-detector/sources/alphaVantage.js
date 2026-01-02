import axios from 'axios';

// Configuration - prefer environment variables with fallbacks
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'SHC76JHTF1N5TMW7';
const BASE_URL = 'https://www.alphavantage.co/query';
const LOOKBACK_HOURS = parseInt(process.env.ALPHA_VANTAGE_LOOKBACK_HOURS || '6');
const QUERY_HOURS = (process.env.ALPHA_VANTAGE_QUERY_HOURS || '6,10,13,16,20')
  .split(',')
  .map(h => parseInt(h.trim()));
const TIMEZONE = process.env.QUERY_TIMEZONE || 'America/New_York';

/**
 * Converts a Date object to the configured timezone
 */
function convertToTimezone(date) {
  try {
    return new Date(date.toLocaleString('en-US', { timeZone: TIMEZONE }));
  } catch (error) {
    console.error(`Invalid timezone ${TIMEZONE}, using UTC:`, error.message);
    return date; // Fallback to UTC
  }
}

/**
 * Determines if the current time matches the query schedule
 */
function shouldQueryNow() {
  const now = new Date();
  const localTime = convertToTimezone(now);
  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();

  // Query only if we're at the top of the hour (00-14 minutes)
  // This gives a 15-minute window for the Lambda to execute
  if (currentMinute >= 0 && currentMinute < 15) {
    return QUERY_HOURS.includes(currentHour);
  }

  return false;
}

/**
 * Converts AlphaVantage timestamp format to ISO 8601
 * Input format: YYYYMMDDTHHmmss (e.g., "20251231T172712")
 * Output format: YYYY-MM-DDTHH:mm:ss±HH:MM (e.g., "2025-12-31T17:27:12-05:00")
 */
function convertAlphaVantageTimestamp(alphaVantageTime) {
  // Parse: YYYYMMDDTHHmmss
  const year = alphaVantageTime.substring(0, 4);
  const month = alphaVantageTime.substring(4, 6);
  const day = alphaVantageTime.substring(6, 8);
  const hour = alphaVantageTime.substring(9, 11);
  const minute = alphaVantageTime.substring(11, 13);
  const second = alphaVantageTime.substring(13, 15);

  // Create date string in format that Date constructor can parse
  const dateString = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

  // Create Date object (assuming UTC since AlphaVantage doesn't provide timezone)
  const date = new Date(dateString + 'Z');

  // Convert to target timezone and get ISO string with offset
  const options = {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset'
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);

  const formatted = {};
  parts.forEach(part => {
    formatted[part.type] = part.value;
  });

  // Build ISO 8601 string with timezone offset
  // Remove "GMT" prefix from timezone (e.g., "GMT-05:00" -> "-05:00")
  const timezoneOffset = formatted.timeZoneName.substring(3);
  const isoString = `${formatted.year}-${formatted.month}-${formatted.day}T${formatted.hour}:${formatted.minute}:${formatted.second}${timezoneOffset}`;

  return isoString;
}

/**
 * Main exported function - queries Alpha Vantage only during scheduled times
 */
export const getAlphaVantageNewsIfScheduled = async (tickers) => {
  if (!shouldQueryNow()) {
    console.log('Skipping Alpha Vantage query - not scheduled for this hour');
    return [];
  }

  console.log(`Scheduled query time - fetching news for ${tickers.length} tickers`);
  return await queryAllTickers(tickers);
};

/**
 * Queries all tickers in parallel with graceful error handling
 */
async function queryAllTickers(tickers) {
  const results = await Promise.allSettled(
    tickers.map(ticker => queryTickerNews(ticker))
  );

  const allNews = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allNews.push(...result.value);
      console.log(`Successfully fetched ${result.value.length} articles for ${tickers[index]}`);
    } else {
      console.error(`Failed to fetch news for ${tickers[index]}:`, result.reason.message);
      // Continue with other tickers - partial success is acceptable
    }
  });

  console.log(`Total articles fetched: ${allNews.length}`);
  return allNews;
}

/**
 * Queries news for a single ticker
 */
async function queryTickerNews(ticker) {
  // Calculate time window
  const now = new Date();
  const lookbackTime = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const timeFrom = lookbackTime.toISOString().slice(0, 16).replace(/-|:/g, '');

  try {
    const { data } = await axios.get(BASE_URL, {
      params: {
        function: 'NEWS_SENTIMENT',
        tickers: ticker, // Single ticker, not comma-separated
        time_from: timeFrom,
        sort: 'LATEST',
        limit: 50,
        apikey: ALPHA_VANTAGE_API_KEY
      }
    });

    // Check for API rate limit response
    if (data.Note && data.Note.includes('API call frequency')) {
      throw new Error(`API_RATE_LIMIT: ${data.Note}`);
    }

    if (!data.feed || !Array.isArray(data.feed)) {
      console.warn(`No valid feed data for ${ticker}`);
      return [];
    }

    return data.feed.map(article => ({
      ticker: ticker, // We know the ticker since we queried individually
      title: article.title,
      url: article.url,
      time_published: convertAlphaVantageTimestamp(article.time_published),
      summary: article.summary,
      sentiment: parseFloat(article.overall_sentiment_score),
      source: article.source
    }));
  } catch (error) {
    console.error(`Alpha Vantage API error for ${ticker}:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return []; // Graceful degradation
  }
}

// Keep the old function name for backward compatibility during testing
export const getAlphaVantageNews = getAlphaVantageNewsIfScheduled;
