import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from '@/types';

export const maxDuration = 120; // seconds
export const dynamic = 'force-dynamic';

const anthropic = new Anthropic();

// Max chars of new chapter text to send in incremental mode
const MAX_NEW_CHARS = 120_000;
// Max chars for full analysis (no prior state)
const MAX_CHARS = 180_000;
const HEAD_CHARS = 50_000;

const SYSTEM_PROMPT = `You are a literary companion that helps readers keep track of characters in the book they are currently reading. Your most important rule is NEVER SPOILING anything beyond what appears in the text provided.

STRICT ANTI-SPOILER RULES (follow these without exception):
1. Base ALL information SOLELY on the text excerpt provided — nothing else.
2. If you recognise this book or series, IGNORE that knowledge entirely. Pretend you have never seen it before.
3. Only report facts that are explicitly stated or clearly implied by the text given.
4. If a character's fate, location, or status is uncertain based on the text, say so — do NOT infer from broader knowledge.
5. Do NOT hint at, foreshadow, or allude to future events in any way.
6. If a character has not appeared yet in the provided text, do NOT include them.

CHARACTER COMPLETENESS RULES:
- Include EVERY named character who appears in the text, no matter how briefly — protagonists, antagonists, and minor characters alike.
- A character mentioned once by name still gets an entry.
- Never filter, skip, or summarize away characters because they seem unimportant.

Your output must be valid JSON and nothing else.`;

const SCHEMA = `{
  "characters": [
    {
      "name": "Full character name",
      "aliases": ["nickname", "title", "other names"],
      "importance": "main" | "secondary" | "minor",
      "status": "alive" | "dead" | "unknown" | "uncertain",
      "lastSeen": "Chapter title where they last appeared",
      "currentLocation": "Last known location, or 'Unknown'",
      "description": "1–2 sentence description of who they are, their role, and appearance/personality as established so far",
      "relationships": [
        { "character": "Other character's name", "relationship": "How they relate" }
      ],
      "recentEvents": "Key things that have happened to or involving this character in the most recent chapters read"
    }
  ],
  "summary": "2–3 sentence summary of where the story stands as of the current chapter, from the reader's perspective"
}`;

function buildFullPrompt(
  bookTitle: string,
  bookAuthor: string,
  currentChapterTitle: string,
  text: string,
): string {
  return `I am reading "${bookTitle}" by ${bookAuthor}. I have just finished the chapter titled "${currentChapterTitle}".

Analyze the text below and extract a COMPLETE character roster — every named character who appears, from major protagonists to characters who appear in a single scene. Do not skip anyone because they seem minor.

TEXT I HAVE READ:
${text}

Return ONLY a JSON object matching this exact schema (no markdown fences, no explanation):
${SCHEMA}`;
}

function buildUpdatePrompt(
  bookTitle: string,
  bookAuthor: string,
  currentChapterTitle: string,
  previousResult: AnalysisResult,
  newChaptersText: string,
): string {
  const prevCount = previousResult.characters.length;
  return `I am reading "${bookTitle}" by ${bookAuthor}. I have just finished the chapter titled "${currentChapterTitle}".

EXISTING CHARACTER STATE (${prevCount} characters — you MUST preserve all ${prevCount} of them):
${JSON.stringify(previousResult, null, 2)}

NEW CHAPTER TEXT TO PROCESS:
${newChaptersText}

INSTRUCTIONS — THIS IS A MERGE OPERATION, NOT A REWRITE:
1. Start with the COMPLETE existing character list above. Copy every one of the ${prevCount} characters into your output unchanged unless the new chapter modifies them.
2. For each character who appears in the new chapter: update only the fields that changed (status, currentLocation, recentEvents, relationships, lastSeen). Keep all other fields as-is.
3. Add any brand-new named characters introduced in the new chapter.
4. Update the summary to reflect the story as of the current chapter.
5. Your output MUST contain at least ${prevCount} characters. If you output fewer than ${prevCount}, you have incorrectly dropped characters.
6. Do NOT use any knowledge of this book beyond what is in the existing state and the new chapter text above.

Return ONLY the complete updated JSON object (same schema, no markdown fences, no explanation):
${SCHEMA}`;
}

// Attempt to recover partial/truncated JSON by extracting complete character objects
function recoverPartialJson(raw: string, previousResult?: AnalysisResult): AnalysisResult | null {
  try {
    // Find the characters array start
    const arrStart = raw.indexOf('"characters"');
    if (arrStart === -1) return null;
    const bracketStart = raw.indexOf('[', arrStart);
    if (bracketStart === -1) return null;

    // Collect complete character objects by scanning for balanced braces
    const characters: AnalysisResult['characters'] = [];
    let i = bracketStart + 1;
    while (i < raw.length) {
      // Skip whitespace/commas
      while (i < raw.length && /[\s,]/.test(raw[i])) i++;
      if (i >= raw.length || raw[i] !== '{') break;

      // Find matching closing brace
      let depth = 0;
      let j = i;
      let inString = false;
      let escape = false;
      while (j < raw.length) {
        const ch = raw[j];
        if (escape) { escape = false; j++; continue; }
        if (ch === '\\' && inString) { escape = true; j++; continue; }
        if (ch === '"') { inString = !inString; j++; continue; }
        if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { j++; break; } }
        }
        j++;
      }
      if (depth !== 0) break; // truncated object — stop here

      try {
        const obj = JSON.parse(raw.slice(i, j));
        characters.push(obj);
      } catch { /* skip malformed object */ }
      i = j;
    }

    if (characters.length === 0) return null;

    // Extract summary if present
    const summaryMatch = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const summary = summaryMatch
      ? summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
      : previousResult?.summary ?? '';

    return { characters, summary };
  } catch {
    return null;
  }
}

// --- Anthropic provider ---
async function callAnthropic(system: string, userPrompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text response from Anthropic.');
  return block.text;
}

// --- Local / OpenAI-compatible provider (Ollama, LM Studio, etc.) ---
async function callLocal(system: string, userPrompt: string): Promise<string> {
  const baseUrl = process.env.LOCAL_MODEL_URL ?? 'http://localhost:11434/v1';
  const model = process.env.LOCAL_MODEL_NAME ?? 'llama3.1:8b';

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 32768,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local model error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content in local model response.');
  return text;
}

export async function POST(req: NextRequest) {
  try {
    const { chaptersRead, newChapters, currentChapterTitle, bookTitle, bookAuthor, previousResult } =
      await req.json() as {
        chaptersRead?: Array<{ title: string; text: string }>;
        newChapters?: Array<{ title: string; text: string }>;
        currentChapterTitle: string;
        bookTitle: string;
        bookAuthor: string;
        previousResult?: AnalysisResult;
      };

    let userPrompt: string;

    if (previousResult && newChapters?.length) {
      // Incremental mode: only send new chapters + existing state
      const newText = newChapters
        .map((ch) => `=== ${ch.title} ===\n\n${ch.text}`)
        .join('\n\n---\n\n');
      const truncatedNew = newText.length > MAX_NEW_CHARS
        ? newText.slice(-MAX_NEW_CHARS)
        : newText;
      userPrompt = buildUpdatePrompt(bookTitle, bookAuthor, currentChapterTitle, previousResult, truncatedNew);
    } else {
      // Full analysis mode
      if (!chaptersRead?.length) {
        return NextResponse.json({ error: 'No chapter text provided.' }, { status: 400 });
      }
      const fullText = chaptersRead
        .map((ch) => `=== ${ch.title} ===\n\n${ch.text}`)
        .join('\n\n---\n\n');
      const truncated = (() => {
        if (fullText.length <= MAX_CHARS) return fullText;
        const head = fullText.slice(0, HEAD_CHARS);
        const tail = fullText.slice(-(MAX_CHARS - HEAD_CHARS));
        return `${head}\n\n[... middle chapters omitted to fit context ...]\n\n${tail}`;
      })();
      userPrompt = buildFullPrompt(bookTitle, bookAuthor, currentChapterTitle, truncated);
    }

    const useLocal = process.env.USE_LOCAL_MODEL === 'true';
    const raw = useLocal
      ? await callLocal(SYSTEM_PROMPT, userPrompt)
      : await callAnthropic(SYSTEM_PROMPT, userPrompt);

    // Strip markdown code fences if the model wraps output in them
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    let result: AnalysisResult;
    try {
      result = JSON.parse(cleaned);
    } catch {
      // Attempt to recover from truncated JSON by extracting the characters array
      const recovered = recoverPartialJson(cleaned, previousResult);
      if (!recovered) {
        console.error('[analyze] Unrecoverable JSON. Raw length:', cleaned.length, 'Preview:', cleaned.slice(-200));
        return NextResponse.json(
          { error: 'Model returned malformed JSON. Try again.' },
          { status: 500 },
        );
      }
      console.warn('[analyze] Recovered from truncated JSON — kept', recovered.characters.length, 'characters');
      result = recovered;
    }

    // Safety net: if the model dropped characters from a previous state, merge them back in
    if (previousResult && Array.isArray(result.characters) && Array.isArray(previousResult.characters)) {
      const returnedNames = new Set(result.characters.map((c) => c.name.toLowerCase()));
      const dropped = previousResult.characters.filter((c) => !returnedNames.has(c.name.toLowerCase()));
      if (dropped.length > 0) {
        console.warn(`[analyze] Model dropped ${dropped.length} characters — merging back:`, dropped.map((c) => c.name));
        result.characters = [...result.characters, ...dropped];
      }
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
