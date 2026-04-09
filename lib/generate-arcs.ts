import type { NarrativeArc, ParentArc } from '@/types';

export async function generateParentArcs(
  bookTitle: string,
  bookAuthor: string,
  arcs: NarrativeArc[],
): Promise<ParentArc[]> {
  let aiSettings: Record<string, string> = {};
  try {
    const { loadAiSettings } = await import('@/lib/ai-client');
    const s = loadAiSettings();
    if (s.provider) aiSettings._provider = s.provider;
    if (s.anthropicKey) aiSettings._apiKey = s.anthropicKey;
    if (s.ollamaUrl) aiSettings._ollamaUrl = s.ollamaUrl;
    if (s.model) aiSettings._model = s.model;
    if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
    if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
    if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
  } catch { /* ignore */ }

  const res = await fetch('/api/group-arcs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTitle, bookAuthor, arcs, ...aiSettings }),
  });
  if (!res.ok) throw new Error('Failed to group arcs');
  const data = await res.json() as { parentArcs: ParentArc[] };
  return data.parentArcs;
}

export async function generateSeriesArcs(
  bookTitle: string,
  bookAuthor: string,
  bookArcs: Array<{ bookTitle: string; parentArcs: ParentArc[] }>,
): Promise<ParentArc[]> {
  let aiSettings: Record<string, string> = {};
  try {
    const { loadAiSettings } = await import('@/lib/ai-client');
    const s = loadAiSettings();
    if (s.provider) aiSettings._provider = s.provider;
    if (s.anthropicKey) aiSettings._apiKey = s.anthropicKey;
    if (s.ollamaUrl) aiSettings._ollamaUrl = s.ollamaUrl;
    if (s.model) aiSettings._model = s.model;
    if (s.geminiKey) aiSettings._geminiKey = s.geminiKey;
    if (s.openaiCompatibleUrl) aiSettings._openaiCompatibleUrl = s.openaiCompatibleUrl;
    if (s.openaiCompatibleKey) aiSettings._openaiCompatibleKey = s.openaiCompatibleKey;
  } catch { /* ignore */ }

  const res = await fetch('/api/group-series-arcs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookTitle, bookAuthor, bookArcs, ...aiSettings }),
  });
  if (!res.ok) throw new Error('Failed to group series arcs');
  const data = await res.json() as { seriesArcs: ParentArc[] };
  return data.seriesArcs;
}
