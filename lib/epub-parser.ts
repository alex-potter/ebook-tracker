import type { EbookChapter, ParsedEbook } from '@/types';

// Runs entirely in the browser using JSZip
export async function parseEpub(file: File): Promise<ParsedEbook> {
  const JSZip = (await import('jszip')).default;
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  // 1. Read container.xml to find the OPF file path
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid EPUB: missing META-INF/container.xml');

  const opfMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfMatch) throw new Error('Invalid EPUB: cannot find OPF path in container.xml');
  const opfPath = opfMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Parse OPF for metadata + manifest + spine
  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error('Invalid EPUB: missing OPF file');

  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const authorMatch = opfXml.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i);
  const title = titleMatch?.[1]?.trim() || file.name.replace('.epub', '');
  const author = authorMatch?.[1]?.trim() || 'Unknown Author';

  // Build manifest: id → href
  const manifestItems: Record<string, string> = {};
  for (const match of opfXml.matchAll(/<item\s[^>]*>/gi)) {
    const tag = match[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifestItems[id] = href;
  }

  // Spine: ordered list of idref
  const spineMatches = [...opfXml.matchAll(/<itemref\s[^>]*idref="([^"]+)"[^>]*\/?>/gi)];

  // 3. Extract chapter text in spine order
  const chapters: EbookChapter[] = [];
  let order = 0;

  for (const spineMatch of spineMatches) {
    const itemId = spineMatch[1];
    const href = manifestItems[itemId];
    if (!href) continue;

    // Try both with and without the OPF directory prefix
    const candidates = [opfDir + href, href, href.replace(/^.*\//, '')];
    let html: string | null = null;
    for (const path of candidates) {
      const decoded = decodeURIComponent(path);
      const entry = zip.file(path) || zip.file(decoded);
      if (entry) {
        html = await entry.async('text');
        break;
      }
    }
    if (!html) continue;

    const text = extractText(html);
    if (text.trim().length < 100) continue; // skip nav/toc/empty files

    // Try to extract a meaningful chapter title from headings
    const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const rawTitle = headingMatch?.[1] ? extractText(headingMatch[1]) : '';
    const chapterTitle = rawTitle.trim() || `Part ${order + 1}`;

    chapters.push({ id: itemId, title: chapterTitle, text: text.trim(), order: order++ });
  }

  if (chapters.length === 0) {
    throw new Error('Could not extract any chapters from this EPUB. The file may be DRM-protected or use an unsupported format.');
  }

  return { title, author, chapters };
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
