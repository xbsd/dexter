/**
 * Data compaction utilities for reducing large financial data to fit token budgets.
 *
 * Strategy:
 * 1. Remove pretty-printing (minify JSON)
 * 2. Query-aware filtering: keep data relevant to the query's date ranges
 * 3. Truncate arrays to most recent N items (detecting date ordering)
 * 4. Remove verbose/redundant fields
 * 5. Summarize deeply nested structures
 */

import { estimateJsonTokens } from './token-counter.js';
import { analyzeQuery, isDateRelevant, getMinRelevantDate, type QueryContext } from './query-analyzer.js';

/**
 * Fields that are often verbose and less critical for analysis.
 * These are candidates for removal when compacting.
 */
const VERBOSE_FIELDS = new Set([
  'reportedCurrency',
  'acceptedDate',
  'fillingDate',
  'link',
  'finalLink',
  'cik',
]);

/**
 * Fields that contain URLs or long text that can be truncated.
 */
const TRUNCATABLE_TEXT_FIELDS = new Set([
  'banner_image',
  'source_url',
  'article_url',
  'image',
]);

/**
 * Compact options for fine-grained control.
 */
export interface CompactOptions {
  maxTokens: number;
  maxArrayLength?: number;       // Max items to keep in arrays (default: 50)
  removeVerboseFields?: boolean; // Remove redundant fields (default: true)
  truncateUrls?: boolean;        // Shorten URLs (default: true)
  minify?: boolean;              // Remove JSON formatting (default: true)
  query?: string;                // Original query for smart filtering
  queryContext?: QueryContext;   // Pre-analyzed query context
}

const DEFAULT_OPTIONS: Omit<Required<CompactOptions>, 'query' | 'queryContext'> = {
  maxTokens: 25_000,
  maxArrayLength: 50, // Increased for better coverage of financial time series
  removeVerboseFields: true,
  truncateUrls: true,
  minify: true,
};

/**
 * Compact a JSON result to fit within a token budget.
 * Uses query-aware filtering when a query is provided.
 * Returns the compacted JSON string.
 */
export function compactJson(
  data: unknown,
  options: CompactOptions = { maxTokens: 25_000 }
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Get or create query context for smart filtering
  const queryContext = opts.queryContext || (opts.query ? analyzeQuery(opts.query) : null);

  // Parse if string
  let parsed: unknown;
  try {
    parsed = typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    // If not valid JSON, truncate as string
    return truncateString(String(data), opts.maxTokens * 3.5);
  }

  // Apply compaction transformations
  let compacted = parsed;

  // Pass 1: Query-aware date filtering (if context available)
  if (queryContext) {
    compacted = filterByQueryContext(compacted, queryContext);
  }

  // Pass 2: Truncate arrays to most recent items
  compacted = truncateArrays(compacted, opts.maxArrayLength);

  // Pass 3: Remove verbose fields if enabled
  if (opts.removeVerboseFields) {
    compacted = removeFields(compacted, VERBOSE_FIELDS);
  }

  // Pass 4: Truncate URLs and long text fields
  if (opts.truncateUrls) {
    compacted = truncateTextFields(compacted, TRUNCATABLE_TEXT_FIELDS);
  }

  // Convert to string (minified or formatted)
  let result = opts.minify
    ? JSON.stringify(compacted)
    : JSON.stringify(compacted, null, 2);

  // Pass 5: If still too large, progressively reduce
  let currentTokens = estimateJsonTokens(result);
  let arrayLimit = opts.maxArrayLength;

  while (currentTokens > opts.maxTokens && arrayLimit > 5) {
    // Reduce array limit and retry
    arrayLimit = Math.floor(arrayLimit * 0.7); // Less aggressive reduction
    compacted = queryContext ? filterByQueryContext(parsed, queryContext) : parsed;
    compacted = truncateArrays(compacted, arrayLimit);
    if (opts.removeVerboseFields) {
      compacted = removeFields(compacted, VERBOSE_FIELDS);
    }
    if (opts.truncateUrls) {
      compacted = truncateTextFields(compacted, TRUNCATABLE_TEXT_FIELDS);
    }
    result = opts.minify
      ? JSON.stringify(compacted)
      : JSON.stringify(compacted, null, 2);
    currentTokens = estimateJsonTokens(result);
  }

  // Final safety: hard truncate if still too large
  if (currentTokens > opts.maxTokens) {
    const maxChars = Math.floor(opts.maxTokens * 3.5);
    result = result.slice(0, maxChars) + '...[truncated]';
  }

  return result;
}

/**
 * Compact multiple tool results to fit a total token budget.
 * Distributes budget fairly across results, with more budget for newer results.
 */
export function compactMultipleResults(
  results: Array<{ description: string; data: unknown }>,
  totalBudget: number
): string[] {
  if (results.length === 0) return [];

  // Give more budget to later (more recent) results
  // Weight distribution: first result gets 1x, last gets 2x
  const weights = results.map((_, i) => 1 + (i / (results.length - 1 || 1)));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  return results.map((result, i) => {
    const budgetShare = Math.floor((weights[i] / totalWeight) * totalBudget);
    const compacted = compactJson(result.data, { maxTokens: budgetShare });
    return `### ${result.description}\n${compacted}`;
  });
}

/**
 * Filter data based on query context - keeps data relevant to the query's
 * date ranges, years, and time periods.
 */
function filterByQueryContext(data: unknown, context: QueryContext): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    // Check if this array contains date-based objects
    if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      const dateField = findDateField(data[0] as Record<string, unknown>);
      if (dateField) {
        // Filter array items by date relevance
        const filtered = data.filter(item => {
          if (typeof item !== 'object' || item === null) return true;
          const dateValue = (item as Record<string, unknown>)[dateField];
          if (typeof dateValue !== 'string') return true;
          return isDateRelevant(dateValue, context, 1);
        });
        // Return filtered array, but keep at least some items
        return filtered.length > 0 ? filtered.map(item => filterByQueryContext(item, context)) : data.slice(0, 20);
      }
    }
    return data.map(item => filterByQueryContext(item, context));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = filterByQueryContext(value, context);
    }
    return result;
  }

  return data;
}

/**
 * Find the date field in an object (if any).
 */
function findDateField(obj: Record<string, unknown>): string | null {
  const dateFields = ['date', 'timestamp', 'time', 'period', 'fiscalDateEnding', 'reportDate', 'publishedDate'];
  for (const field of dateFields) {
    if (field in obj && typeof obj[field] === 'string') {
      // Verify it looks like a date
      const value = obj[field] as string;
      if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value) || !isNaN(Date.parse(value))) {
        return field;
      }
    }
  }
  return null;
}

/**
 * Detect if an array of objects is sorted by date (newest first or oldest first).
 * Returns 'newest-first', 'oldest-first', or 'unknown'.
 */
function detectDateOrdering(arr: unknown[]): 'newest-first' | 'oldest-first' | 'unknown' {
  if (arr.length < 2) return 'unknown';

  // Check first two items for date fields
  const first = arr[0];
  const second = arr[1];

  if (typeof first !== 'object' || typeof second !== 'object' || !first || !second) {
    return 'unknown';
  }

  // Look for common date field names
  const dateFields = ['date', 'timestamp', 'time', 'period', 'fiscalDateEnding', 'reportDate'];
  for (const field of dateFields) {
    const firstDate = (first as Record<string, unknown>)[field];
    const secondDate = (second as Record<string, unknown>)[field];

    if (typeof firstDate === 'string' && typeof secondDate === 'string') {
      // Parse dates and compare
      const d1 = new Date(firstDate).getTime();
      const d2 = new Date(secondDate).getTime();

      if (!isNaN(d1) && !isNaN(d2)) {
        return d1 > d2 ? 'newest-first' : 'oldest-first';
      }
    }
  }

  return 'unknown';
}

/**
 * Truncate arrays to keep only the most recent N items.
 * Detects date ordering to ensure we keep recent data, not old data.
 */
function truncateArrays(data: unknown, maxLength: number): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    if (data.length <= maxLength) {
      return data.map(item => truncateArrays(item, maxLength));
    }

    // Detect ordering and truncate appropriately
    const ordering = detectDateOrdering(data);

    let truncated: unknown[];
    if (ordering === 'newest-first') {
      // Data is newest-first (index 0 = most recent), keep from beginning
      truncated = data.slice(0, maxLength);
    } else if (ordering === 'oldest-first') {
      // Data is oldest-first (index 0 = oldest), keep from end
      truncated = data.slice(-maxLength);
    } else {
      // Unknown ordering - keep from beginning (safer default for most APIs)
      truncated = data.slice(0, maxLength);
    }

    return truncated.map(item => truncateArrays(item, maxLength));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateArrays(value, maxLength);
    }
    return result;
  }

  return data;
}

/**
 * Remove specified fields from an object recursively.
 */
function removeFields(data: unknown, fieldsToRemove: Set<string>): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => removeFields(item, fieldsToRemove));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!fieldsToRemove.has(key)) {
        result[key] = removeFields(value, fieldsToRemove);
      }
    }
    return result;
  }

  return data;
}

/**
 * Truncate URL and long text fields to save space.
 */
function truncateTextFields(data: unknown, fields: Set<string>): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(item => truncateTextFields(item, fields));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (fields.has(key) && typeof value === 'string' && value.length > 50) {
        // Truncate URLs and long text, keeping domain for URLs
        if (value.startsWith('http')) {
          try {
            const url = new URL(value);
            result[key] = `${url.origin}/...`;
          } catch {
            result[key] = value.slice(0, 50) + '...';
          }
        } else {
          result[key] = value.slice(0, 100) + '...';
        }
      } else {
        result[key] = truncateTextFields(value, fields);
      }
    }
    return result;
  }

  return data;
}

/**
 * Simple string truncation with character limit.
 */
function truncateString(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return str.slice(0, maxChars) + '...[truncated]';
}

/**
 * Create a summary when data is extremely large.
 * Extracts key metrics and recent data points.
 */
export function createDataSummary(data: unknown, description: string): string {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return `${description}: [data parsing error]`;
    }
  }

  if (Array.isArray(data)) {
    const count = data.length;
    const sample = data.slice(-3); // Last 3 items
    return `${description}: ${count} records. Recent: ${JSON.stringify(sample)}`;
  }

  if (typeof data === 'object' && data !== null) {
    const keys = Object.keys(data);
    return `${description}: Object with keys [${keys.slice(0, 10).join(', ')}${keys.length > 10 ? '...' : ''}]`;
  }

  return `${description}: ${String(data).slice(0, 200)}`;
}
