// lib/context-window.ts

import { Agent, fetch as undiciFetch } from 'undici';
import type { ProviderType } from './rate-limiter';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChapterChunk {
  text: string;
  index: number;   // 0-based sub-chunk index
  total: number;   // total sub-chunks for this chapter
}

export interface ContextConfig {
  provider: ProviderType;
  model: string;
  baseUrl?: string;
  apiKey?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 3.5;
const OVERLAP_CHARS = 500;

// ─── Token estimation ────────────────────────────────────────────────────────

/** Estimate the number of tokens in a string. Conservative (3.5 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Convert a token count to approximate character count. */
export function tokensToChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN);
}
