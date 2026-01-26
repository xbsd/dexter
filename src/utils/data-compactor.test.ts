import { describe, expect, test } from 'bun:test';
import { compactJson, compactMultipleResults, createDataSummary } from './data-compactor.js';
import { estimateTokens, estimateJsonTokens } from './token-counter.js';

describe('compactJson', () => {
  test('should minify JSON by default', () => {
    const input = { foo: 'bar', nested: { a: 1 } };
    const result = compactJson(input, { maxTokens: 1000 });
    // Should not have pretty-printing
    expect(result).not.toContain('\n');
    expect(result).toBe('{"foo":"bar","nested":{"a":1}}');
  });

  test('should truncate arrays keeping most recent (newest-first data)', () => {
    // Simulate financial data that's ordered newest-first (most APIs)
    const input = {
      prices: [
        { date: '2026-01-20', price: 100 },
        { date: '2026-01-19', price: 99 },
        { date: '2026-01-18', price: 98 },
        { date: '2026-01-17', price: 97 },
        { date: '2026-01-16', price: 96 },
        { date: '2026-01-15', price: 95 },
      ],
    };
    const result = compactJson(input, { maxTokens: 1000, maxArrayLength: 3 });
    const parsed = JSON.parse(result);
    // Should keep first 3 items (most recent) since data is newest-first
    expect(parsed.prices.length).toBe(3);
    expect(parsed.prices[0].date).toBe('2026-01-20'); // Most recent
    expect(parsed.prices[2].date).toBe('2026-01-18');
  });

  test('should truncate arrays keeping most recent (oldest-first data)', () => {
    // Simulate data ordered oldest-first
    const input = {
      prices: [
        { date: '2026-01-15', price: 95 },
        { date: '2026-01-16', price: 96 },
        { date: '2026-01-17', price: 97 },
        { date: '2026-01-18', price: 98 },
        { date: '2026-01-19', price: 99 },
        { date: '2026-01-20', price: 100 },
      ],
    };
    const result = compactJson(input, { maxTokens: 1000, maxArrayLength: 3 });
    const parsed = JSON.parse(result);
    // Should keep last 3 items (most recent) since data is oldest-first
    expect(parsed.prices.length).toBe(3);
    expect(parsed.prices[0].date).toBe('2026-01-18');
    expect(parsed.prices[2].date).toBe('2026-01-20'); // Most recent
  });

  test('should remove verbose fields when enabled', () => {
    const input = {
      ticker: 'AAPL',
      price: 150,
      reportedCurrency: 'USD',
      acceptedDate: '2024-01-01',
      fillingDate: '2024-01-02',
      cik: '123456',
    };
    const result = compactJson(input, { maxTokens: 1000, removeVerboseFields: true });
    const parsed = JSON.parse(result);
    expect(parsed.ticker).toBe('AAPL'); // ticker is kept now
    expect(parsed.price).toBe(150);
    expect(parsed.reportedCurrency).toBeUndefined();
    expect(parsed.acceptedDate).toBeUndefined();
    expect(parsed.cik).toBeUndefined();
  });

  test('should truncate image URLs and source URLs', () => {
    const input = {
      title: 'Test',
      url: 'https://example.com/article', // Regular URL - kept
      banner_image: 'https://images.example.com/very/long/path/to/image.jpg?with=params',
      source_url: 'https://source.example.com/very/long/path/to/source?id=123',
    };
    const result = compactJson(input, { maxTokens: 1000, truncateUrls: true });
    const parsed = JSON.parse(result);
    expect(parsed.url).toBe('https://example.com/article'); // Kept as-is
    expect(parsed.banner_image).toBe('https://images.example.com/...'); // Truncated
    expect(parsed.source_url).toBe('https://source.example.com/...'); // Truncated
  });

  test('should progressively reduce array size to fit budget', () => {
    // Create a large array that exceeds budget
    const largeArray = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: 'This is a moderately long description that adds to the token count',
    }));
    const input = { data: largeArray };

    const result = compactJson(input, { maxTokens: 500 });
    const parsed = JSON.parse(result);

    // Should have reduced the array
    expect(parsed.data.length).toBeLessThan(100);
    // Result should fit within budget (approximately)
    expect(estimateJsonTokens(result)).toBeLessThanOrEqual(550); // Allow small overage
  });

  test('should handle string input', () => {
    const input = '{"test": "value"}';
    const result = compactJson(input, { maxTokens: 1000 });
    expect(result).toBe('{"test":"value"}');
  });

  test('should handle invalid JSON string gracefully', () => {
    const input = 'not valid json';
    const result = compactJson(input, { maxTokens: 1000 });
    expect(result).toBe('not valid json');
  });
});

describe('compactMultipleResults', () => {
  test('should distribute budget across results', () => {
    const results = [
      { description: 'Result 1', data: { a: 1 } },
      { description: 'Result 2', data: { b: 2 } },
    ];
    const compacted = compactMultipleResults(results, 1000);
    expect(compacted.length).toBe(2);
    expect(compacted[0]).toContain('### Result 1');
    expect(compacted[1]).toContain('### Result 2');
  });

  test('should give more budget to later (more recent) results', () => {
    // This test verifies the weighting logic
    const largeData = { items: Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'data' })) };
    const results = [
      { description: 'Old data', data: largeData },
      { description: 'Recent data', data: largeData },
    ];
    const compacted = compactMultipleResults(results, 2000);

    // Recent data (second) should have more items preserved
    const oldCount = (JSON.parse(compacted[0].replace('### Old data\n', '')).items || []).length;
    const recentCount = (JSON.parse(compacted[1].replace('### Recent data\n', '')).items || []).length;
    expect(recentCount).toBeGreaterThanOrEqual(oldCount);
  });
});

describe('createDataSummary', () => {
  test('should summarize arrays', () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const summary = createDataSummary(data, 'Test data');
    expect(summary).toContain('3 records');
    expect(summary).toContain('Test data');
  });

  test('should summarize objects', () => {
    const data = { key1: 'value1', key2: 'value2' };
    const summary = createDataSummary(data, 'Test object');
    expect(summary).toContain('Object with keys');
    expect(summary).toContain('key1');
    expect(summary).toContain('key2');
  });

  test('should handle JSON strings', () => {
    const data = '[{"id":1},{"id":2}]';
    const summary = createDataSummary(data, 'JSON string');
    expect(summary).toContain('2 records');
  });
});

describe('estimateTokens', () => {
  test('should estimate text tokens (~4 chars per token)', () => {
    const text = 'Hello world'; // 11 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBe(3); // ceil(11/4) = 3
  });

  test('should estimate JSON tokens (~3.5 chars per token)', () => {
    const json = '{"key":"value"}'; // 15 chars
    const tokens = estimateTokens(json, 'json');
    expect(tokens).toBe(5); // ceil(15/3.5) = 5
  });
});
