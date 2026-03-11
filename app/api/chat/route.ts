import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Agent, fetch as undiciFetch } from 'undici';

const ollamaAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const anthropic = new Anthropic();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const { systemPrompt, messages, _provider, _apiKey, _ollamaUrl, _model } =
      await req.json() as {
        systemPrompt: string;
        messages: ChatMessage[];
        _provider?: 'anthropic' | 'ollama';
        _apiKey?: string;
        _ollamaUrl?: string;
        _model?: string;
      };

    const serverHasKey = !!process.env.ANTHROPIC_API_KEY;
    const serverUsesLocal = process.env.USE_LOCAL_MODEL === 'true';
    const serverConfigured = serverHasKey || serverUsesLocal;
    const useLocal = serverConfigured ? serverUsesLocal : (_provider !== 'anthropic');

    let reply: string;

    if (useLocal) {
      const baseUrl = process.env.LOCAL_MODEL_URL ?? _ollamaUrl ?? 'http://localhost:11434/v1';
      const model = process.env.LOCAL_MODEL_NAME ?? _model ?? 'qwen2.5:14b';
      const res = await undiciFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        dispatcher: ollamaAgent,
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      } as Parameters<typeof undiciFetch>[1]);
      if (!res.ok) throw new Error(`Model error (${res.status}): ${await res.text()}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      reply = data.choices?.[0]?.message?.content ?? '';
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? _apiKey;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'No Anthropic API key configured. Open ⚙ Settings to add your key.' },
          { status: 400 },
        );
      }
      const client = apiKey !== process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey }) : anthropic;
      const response = await client.messages.create({
        model: _model ?? 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      });
      const block = response.content.find((b) => b.type === 'text');
      reply = block?.type === 'text' ? block.text : '';
    }

    return NextResponse.json({ reply });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat failed.';
    console.error('[chat] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
