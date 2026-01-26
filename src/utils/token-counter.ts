/**
 * Simple token estimation utilities.
 *
 * These are approximations based on common tokenizer patterns:
 * - ~4 characters per token for English text
 * - ~3.5 characters per token for JSON/code (due to punctuation)
 *
 * For production use, consider using tiktoken or model-specific tokenizers.
 */

// Characters per token estimates by content type
const CHARS_PER_TOKEN = {
  text: 4,
  json: 3.5,
  code: 3.5,
};

/**
 * Estimate token count for a string.
 * Uses conservative estimates to avoid underestimating.
 */
export function estimateTokens(text: string, type: 'text' | 'json' | 'code' = 'text'): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN[type]);
}

/**
 * Estimate token count for JSON data.
 * Accounts for the extra punctuation in JSON.
 */
export function estimateJsonTokens(data: unknown): number {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  return estimateTokens(jsonStr, 'json');
}

/**
 * Check if content exceeds a token budget.
 */
export function exceedsTokenBudget(text: string, budget: number, type: 'text' | 'json' | 'code' = 'text'): boolean {
  return estimateTokens(text, type) > budget;
}

/**
 * Token budget configuration for different use cases.
 * These are tuned for models with ~272k token limits (like GPT-5.2).
 */
export const TOKEN_BUDGETS = {
  // For models with 256k+ context (GPT-5.2, GPT-4-turbo, Claude)
  large: {
    maxInput: 200_000,       // Leave 72k for output and overhead
    toolResults: 150_000,    // Max tokens for all tool results (generous for financial data)
    perToolResult: 40_000,   // Max tokens per individual tool result
    chatHistory: 10_000,     // Max tokens for chat history context
  },
  // For models with smaller context (older GPT-3.5, etc.)
  small: {
    maxInput: 12_000,
    toolResults: 8_000,
    perToolResult: 3_000,
    chatHistory: 2_000,
  },
} as const;

export type TokenBudget = {
  maxInput: number;
  toolResults: number;
  perToolResult: number;
  chatHistory: number;
};

/**
 * Get appropriate token budget based on model.
 */
export function getTokenBudget(model: string): TokenBudget {
  // Most modern models have large context windows
  const smallContextModels = ['gpt-3.5-turbo', 'gpt-3.5'];
  const isSmall = smallContextModels.some(m => model.toLowerCase().includes(m));
  return isSmall ? TOKEN_BUDGETS.small : TOKEN_BUDGETS.large;
}
