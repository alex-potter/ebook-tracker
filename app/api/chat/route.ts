import { NextRequest, NextResponse } from 'next/server';
import { callLLM, resolveConfig } from '@/lib/llm';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      systemPrompt: string;
      messages: ChatMessage[];
      _provider?: string;
      _apiKey?: string;
      _ollamaUrl?: string;
      _model?: string;
      _geminiKey?: string;
      _openaiCompatibleUrl?: string;
      _openaiCompatibleKey?: string;
    };
    const { systemPrompt, messages } = body;
    const config = resolveConfig(body);

    const { text } = await callLLM({
      ...config,
      system: systemPrompt,
      userPrompt: '',
      maxTokens: 1024,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    return NextResponse.json({ reply: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat failed.';
    console.error('[chat] error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
