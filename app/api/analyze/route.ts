import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120; // seconds
export const dynamic = 'force-dynamic';

const anthropic = new Anthropic();

// How many characters of book text we'll send (fits within most model context windows)
const MAX_CHARS = 180_000;

const SYSTEM_PROMPT = `You are a literary companion that helps readers keep track of characters in the book they are currently reading. Your most important rule is NEVER SPOILING anything beyond what appears in the text provided.

STRICT ANTI-SPOILER RULES (follow these without exception):
1. Base ALL information SOLELY on the text excerpt provided — nothing else.
2. If you recognise this book or series, IGNORE that knowledge entirely. Pretend you have never seen it before.
3. Only report facts that are explicitly stated or clearly implied by the text given.
4. If a character's fate, location, or status is uncertain based on the text, say so — do NOT infer from broader knowledge.
5. Do NOT hint at, foreshadow, or allude to future events in any way.
6. If a character has not appeared yet in the provided text, do NOT include them.

Your output must be valid JSON and nothing else.`;

function buildUserPrompt(
  bookTitle: string,
  bookAuthor: string,
  currentChapterTitle: string,
  truncated: string,
): string {
  return `I am reading "${bookTitle}" by ${bookAuthor}. I have just finished the chapter titled "${currentChapterTitle}".

Below is everything I have read so far. Please analyze it and return a JSON object tracking the characters and story state as I understand them RIGHT NOW — no more, no less.

TEXT I HAVE READ:
${truncated}

Return ONLY a JSON object matching this exact schema (no markdown fences, no explanation):
{
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
}

// --- Anthropic provider ---
async function callAnthropic(system: string, userPrompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
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
      max_tokens: 4096,
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
    const { chaptersRead, currentChapterTitle, bookTitle, bookAuthor } = await req.json() as {
      chaptersRead: Array<{ title: string; text: string }>;
      currentChapterTitle: string;
      bookTitle: string;
      bookAuthor: string;
    };

    if (!chaptersRead?.length) {
      return NextResponse.json({ error: 'No chapter text provided.' }, { status: 400 });
    }

    const fullText = chaptersRead
      .map((ch) => `=== ${ch.title} ===\n\n${ch.text}`)
      .join('\n\n---\n\n');

    const truncated =
      fullText.length > MAX_CHARS
        ? `[Earlier chapters omitted to fit context]\n\n...\n\n${fullText.slice(-MAX_CHARS)}`
        : fullText;

    const userPrompt = buildUserPrompt(bookTitle, bookAuthor, currentChapterTitle, truncated);

    const useLocal = process.env.USE_LOCAL_MODEL === 'true';
    const raw = useLocal
      ? await callLocal(SYSTEM_PROMPT, userPrompt)
      : await callAnthropic(SYSTEM_PROMPT, userPrompt);

    // Strip markdown code fences if the model wraps output in them
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: 'Model returned malformed JSON. Try again.', raw },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[analyze] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
