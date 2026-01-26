/**
 * Query analyzer for smart, context-aware data compaction.
 *
 * Extracts date ranges, years, and time periods from queries to ensure
 * relevant data is preserved during compaction.
 */

export interface QueryContext {
  years: number[];              // Specific years mentioned (e.g., [2020, 2024])
  dateRanges: Array<{ start: Date; end: Date }>; // Date ranges
  timePeriods: string[];        // Relative periods (e.g., "past 2 years", "last quarter")
  tickers: string[];            // Stock tickers mentioned
  requiresFullData: boolean;    // Query needs complete dataset (for calculations)
  calculationKeywords: string[]; // Keywords suggesting calculations needed
}

// Patterns that suggest full data is needed for calculations
const CALCULATION_KEYWORDS = [
  'return', 'returns', 'cagr', 'annualized', 'growth rate',
  'volatility', 'standard deviation', 'sharpe', 'beta', 'alpha',
  'correlation', 'moving average', 'ma', 'sma', 'ema',
  'trend', 'regression', 'performance', 'compare', 'comparison',
  'drawdown', 'max drawdown', 'high', 'low', 'range',
  'ytd', 'mtd', 'qtd', 'year to date', 'month to date',
  'total return', 'price return', 'cumulative',
];

// Common ticker patterns
const TICKER_PATTERN = /\b([A-Z]{1,5})\b/g;

// Known tickers to avoid false positives
const COMMON_TICKERS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA',
  'AMD', 'INTC', 'IBM', 'ORCL', 'CRM', 'ADBE', 'NFLX', 'PYPL',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'ARKK',
  'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'V', 'MA', 'AXP',
  'JNJ', 'PFE', 'UNH', 'MRK', 'ABBV', 'LLY', 'BMY',
  'XOM', 'CVX', 'COP', 'SLB', 'OXY',
  'DIS', 'CMCSA', 'T', 'VZ', 'TMUS',
  'WMT', 'COST', 'TGT', 'HD', 'LOW', 'NKE', 'SBUX',
  'BA', 'CAT', 'GE', 'HON', 'MMM', 'UPS', 'FDX',
  'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE',
]);

// Words that look like tickers but aren't
const TICKER_EXCLUSIONS = new Set([
  'THE', 'AND', 'FOR', 'NOT', 'ARE', 'BUT', 'HAS', 'HAD', 'WAS', 'CAN',
  'ALL', 'HER', 'HIS', 'ITS', 'OUR', 'WHO', 'HOW', 'WHY', 'DID', 'GET',
  'NOW', 'NEW', 'OLD', 'TOP', 'LOW', 'HIGH', 'USD', 'EUR', 'GBP', 'JPY',
  'YTD', 'MTD', 'QTD', 'TTM', 'MOM', 'YOY', 'QOQ', 'API', 'IPO', 'CEO',
  'CFO', 'COO', 'CTO', 'GDP', 'CPI', 'PPI', 'PMI', 'PCE', 'FED', 'SEC',
  'FCF', 'EPS', 'ROE', 'ROA', 'ROI', 'PER', 'DAY', 'FY23', 'FY24', 'FY25',
]);

/**
 * Analyze a query to extract context for smart data compaction.
 */
export function analyzeQuery(query: string): QueryContext {
  const lowerQuery = query.toLowerCase();

  const years = extractYears(query);
  const dateRanges = extractDateRanges(query);
  const timePeriods = extractTimePeriods(query);
  const tickers = extractTickers(query);
  const calculationKeywords = CALCULATION_KEYWORDS.filter(kw => lowerQuery.includes(kw));

  // Determine if full data is needed
  const requiresFullData =
    calculationKeywords.length > 0 ||
    timePeriods.some(p => p.includes('year') || p.includes('annual') || p.includes('all time')) ||
    years.length > 1 || // Comparing across years
    dateRanges.length > 0;

  return {
    years,
    dateRanges,
    timePeriods,
    tickers,
    requiresFullData,
    calculationKeywords,
  };
}

/**
 * Extract years mentioned in the query.
 */
function extractYears(query: string): number[] {
  const years: number[] = [];

  // Match 4-digit years (1990-2030 range)
  const yearPattern = /\b(19[89]\d|20[0-3]\d)\b/g;
  let match;
  while ((match = yearPattern.exec(query)) !== null) {
    years.push(parseInt(match[1], 10));
  }

  // Match fiscal year patterns (FY23, FY2024)
  const fyPattern = /\bFY['']?(\d{2,4})\b/gi;
  while ((match = fyPattern.exec(query)) !== null) {
    let year = parseInt(match[1], 10);
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }
    if (!years.includes(year)) {
      years.push(year);
    }
  }

  return years.sort();
}

/**
 * Extract date ranges from the query.
 */
function extractDateRanges(query: string): Array<{ start: Date; end: Date }> {
  const ranges: Array<{ start: Date; end: Date }> = [];
  const now = new Date();

  // Pattern: "from X to Y" or "between X and Y"
  const rangePattern = /(?:from|between)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4}|\d{4})\s+(?:to|and)\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4}|\d{4})/gi;

  let match;
  while ((match = rangePattern.exec(query)) !== null) {
    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (start && end) {
      ranges.push({ start, end });
    }
  }

  // "past N years/months"
  const pastPattern = /past\s+(\d+)\s+(year|month|week|day)s?/gi;
  while ((match = pastPattern.exec(query)) !== null) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const start = new Date(now);

    switch (unit) {
      case 'year': start.setFullYear(start.getFullYear() - amount); break;
      case 'month': start.setMonth(start.getMonth() - amount); break;
      case 'week': start.setDate(start.getDate() - amount * 7); break;
      case 'day': start.setDate(start.getDate() - amount); break;
    }

    ranges.push({ start, end: now });
  }

  // "last N years/months"
  const lastPattern = /last\s+(\d+)\s+(year|month|week|day)s?/gi;
  while ((match = lastPattern.exec(query)) !== null) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const start = new Date(now);

    switch (unit) {
      case 'year': start.setFullYear(start.getFullYear() - amount); break;
      case 'month': start.setMonth(start.getMonth() - amount); break;
      case 'week': start.setDate(start.getDate() - amount * 7); break;
      case 'day': start.setDate(start.getDate() - amount); break;
    }

    ranges.push({ start, end: now });
  }

  return ranges;
}

/**
 * Extract time period descriptions.
 */
function extractTimePeriods(query: string): string[] {
  const periods: string[] = [];
  const lowerQuery = query.toLowerCase();

  const periodPatterns = [
    /past\s+\d+\s+(?:year|month|week|day)s?/gi,
    /last\s+\d+\s+(?:year|month|week|day)s?/gi,
    /\d+[-\s]?year/gi,
    /ytd|year[\s-]?to[\s-]?date/gi,
    /mtd|month[\s-]?to[\s-]?date/gi,
    /qtd|quarter[\s-]?to[\s-]?date/gi,
    /ttm|trailing\s+twelve\s+months?/gi,
    /last\s+(?:quarter|q[1-4])/gi,
    /(?:q[1-4]|first|second|third|fourth)\s+quarter/gi,
    /all[\s-]?time/gi,
    /since\s+(?:inception|ipo|listing)/gi,
  ];

  for (const pattern of periodPatterns) {
    let match;
    while ((match = pattern.exec(query)) !== null) {
      periods.push(match[0].toLowerCase());
    }
  }

  // Check for common period keywords
  const keywordPeriods = ['yesterday', 'today', 'this week', 'this month', 'this year'];
  for (const kw of keywordPeriods) {
    if (lowerQuery.includes(kw)) {
      periods.push(kw);
    }
  }

  return [...new Set(periods)];
}

/**
 * Extract stock tickers from the query.
 */
function extractTickers(query: string): string[] {
  const tickers: string[] = [];

  // Match potential tickers
  let match;
  while ((match = TICKER_PATTERN.exec(query)) !== null) {
    const potential = match[1];
    if (COMMON_TICKERS.has(potential) && !TICKER_EXCLUSIONS.has(potential)) {
      tickers.push(potential);
    }
  }

  // Also match $TICKER format
  const dollarPattern = /\$([A-Z]{1,5})\b/g;
  while ((match = dollarPattern.exec(query)) !== null) {
    if (!tickers.includes(match[1])) {
      tickers.push(match[1]);
    }
  }

  return [...new Set(tickers)];
}

/**
 * Parse a date string into a Date object.
 */
function parseDate(dateStr: string): Date | null {
  // Try direct parsing
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  // Try year-only
  const yearOnly = parseInt(dateStr, 10);
  if (yearOnly >= 1900 && yearOnly <= 2100) {
    return new Date(yearOnly, 0, 1);
  }

  return null;
}

/**
 * Check if a date falls within any of the query's relevant ranges.
 */
export function isDateRelevant(
  dateStr: string,
  context: QueryContext,
  toleranceYears: number = 1
): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return true; // Can't parse, keep it

  const year = date.getFullYear();

  // If no specific dates mentioned, keep recent data
  if (context.years.length === 0 && context.dateRanges.length === 0) {
    const currentYear = new Date().getFullYear();
    return year >= currentYear - 3; // Keep last 3 years by default
  }

  // Check if year matches any mentioned year (with tolerance)
  for (const y of context.years) {
    if (Math.abs(year - y) <= toleranceYears) {
      return true;
    }
  }

  // Check if date falls within any range (with tolerance)
  for (const range of context.dateRanges) {
    const startYear = range.start.getFullYear() - toleranceYears;
    const endYear = range.end.getFullYear() + toleranceYears;
    if (year >= startYear && year <= endYear) {
      return true;
    }
  }

  return false;
}

/**
 * Get the minimum date that should be kept based on query context.
 */
export function getMinRelevantDate(context: QueryContext): Date {
  const now = new Date();

  // Default: 2 years back
  let minDate = new Date(now);
  minDate.setFullYear(minDate.getFullYear() - 2);

  // Check for explicit date ranges
  if (context.dateRanges.length > 0) {
    const earliest = context.dateRanges.reduce((min, range) =>
      range.start < min ? range.start : min,
      context.dateRanges[0].start
    );
    if (earliest < minDate) {
      minDate = earliest;
    }
  }

  // Check for explicit years
  if (context.years.length > 0) {
    const minYear = Math.min(...context.years);
    const yearDate = new Date(minYear, 0, 1);
    if (yearDate < minDate) {
      minDate = yearDate;
    }
  }

  return minDate;
}
