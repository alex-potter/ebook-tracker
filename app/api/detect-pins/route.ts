import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type { LocationPin } from '@/types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const anthropic = new Anthropic();

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export async function POST(req: NextRequest) {
  try {
    const { imageDataUrl, locations } = (await req.json()) as {
      imageDataUrl: string;
      locations: string[];
    };

    if (!imageDataUrl || !locations?.length) {
      return NextResponse.json({ error: 'Missing imageDataUrl or locations' }, { status: 400 });
    }

    // Parse data URL  →  "data:<type>;base64,<data>"
    const commaIdx = imageDataUrl.indexOf(',');
    const header = imageDataUrl.slice(0, commaIdx);
    const base64Data = imageDataUrl.slice(commaIdx + 1);
    const rawType = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
    const mediaType = SUPPORTED_TYPES.has(rawType)
      ? (rawType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
      : 'image/png';

    const prompt = `This is a map image. I have a list of location names that characters in a story occupy. Your job is to find each location name as written text on the map and return its approximate center position.

Return ONLY a JSON object — no prose, no markdown fences. Schema:
{"pins": {"Location Name": {"x": 45.2, "y": 23.1}, ...}}

Where x and y are percentages of the image width and height respectively (0 = left/top, 100 = right/bottom).

Rules:
- Only include locations you can actually read on the map as visible text labels.
- If a name does not appear on the map, omit it entirely.
- Partial matches are fine (e.g. "The Eyrie" matches a label that says "Eyrie").
- x and y should point to the center of the text label.

Locations to find:
${locations.map((l) => `- ${l}`).join('\n')}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Data },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Extract JSON object from response (strip any accidental markdown)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ pins: {} });

    const parsed = JSON.parse(jsonMatch[0]) as { pins?: Record<string, LocationPin> };
    const pins: Record<string, LocationPin> = {};

    for (const [name, pos] of Object.entries(parsed.pins ?? {})) {
      // Validate and clamp values
      const x = Math.max(0, Math.min(100, Number(pos.x)));
      const y = Math.max(0, Math.min(100, Number(pos.y)));
      if (!isNaN(x) && !isNaN(y)) pins[name] = { x, y };
    }

    return NextResponse.json({ pins });
  } catch (err) {
    console.error('[detect-pins]', err);
    return NextResponse.json({ error: 'Detection failed' }, { status: 500 });
  }
}
