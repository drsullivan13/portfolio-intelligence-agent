/**
 * Ticker Aggregation Utility
 *
 * Aggregates tickers from multiple user watchlists to process each ticker only once,
 * regardless of how many users are watching it. This dramatically reduces API calls
 * to AlphaVantage and SEC Edgar when multiple users watch the same tickers.
 */

/**
 * Aggregates tickers from all user watchlists
 *
 * @param {Map<string, string[]>} userWatchlists - Map of userId => ticker array
 * @returns {Map<string, Set<string>>} Map of ticker => Set of userIds watching that ticker
 *
 * @example
 * Input:
 *   Map {
 *     'user1' => ['TSLA', 'NVDA'],
 *     'user2' => ['TSLA', 'AAPL'],
 *     'user3' => ['NVDA']
 *   }
 *
 * Output:
 *   Map {
 *     'TSLA' => Set('user1', 'user2'),
 *     'NVDA' => Set('user1', 'user3'),
 *     'AAPL' => Set('user2')
 *   }
 */
function aggregateTickersFromWatchlists(userWatchlists) {
  const tickerToUsers = new Map();

  for (const [userId, tickers] of userWatchlists) {
    for (const ticker of tickers) {
      if (!tickerToUsers.has(ticker)) {
        tickerToUsers.set(ticker, new Set());
      }
      tickerToUsers.get(ticker).add(userId);
    }
  }

  console.log(`[TickerAggregator] Aggregated ${tickerToUsers.size} unique tickers from ${userWatchlists.size} users`);

  // Log ticker sharing stats
  const sharingStats = {
    totalTickers: tickerToUsers.size,
    sharedTickers: 0,
    maxWatchers: 0
  };

  for (const [ticker, userIds] of tickerToUsers) {
    const watcherCount = userIds.size;
    if (watcherCount > 1) {
      sharingStats.sharedTickers++;
    }
    if (watcherCount > sharingStats.maxWatchers) {
      sharingStats.maxWatchers = watcherCount;
    }
  }

  console.log(`[TickerAggregator] Sharing stats:`, sharingStats);

  return tickerToUsers;
}

export { aggregateTickersFromWatchlists };
