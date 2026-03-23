# BookBuddy

> Track characters as you read — spoiler-free.

[![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/demo-live-blue)](https://alex-potter.github.io/bookbuddy/)
[![PWA](https://img.shields.io/badge/PWA-ready-orange)]()

<img src="docs/screenshots/hero.png" alt="BookBuddy dashboard showing character cards, chapter sidebar, and analysis results" width="100%" />

## Try it now

**[Launch BookBuddy](https://alex-potter.github.io/bookbuddy/)** — no install needed. Runs entirely in your browser.

## What it does

Upload any EPUB, pick your chapter, and AI analyzes **only what you've read** to give you a spoiler-safe dashboard.

- **Characters** — status, location, relationships, recent events
- **Locations** — where things happen in the story
- **Map** — locations pinned on an interactive map
- **Story arcs** — plotlines tracked chapter by chapter
- **Chat** — ask spoiler-free questions about the book

<p>
  <img src="docs/screenshots/characters.png" alt="Characters tab showing cards with status indicators" width="49%" />
  <img src="docs/screenshots/locations.png" alt="Locations tab with location entries" width="49%" />
</p>
<p>
  <img src="docs/screenshots/map.png" alt="Map tab with pinned locations" width="49%" />
  <img src="docs/screenshots/arcs.png" alt="Arcs tab with narrative arc timelines" width="49%" />
</p>

## How it works

| Step | What happens |
|------|-------------|
| Upload EPUB | Parsed entirely in your browser (JSZip) — never uploaded to a server |
| Pick chapter | Use the sidebar to select which chapter you've just finished |
| Analyze | Claude reads only the text up to your current chapter |
| Dashboard | Character cards show status, location, relationships, recent events |

## Anti-spoiler design

- The EPUB is parsed **client-side** in your browser
- Only text up to your current chapter is sent to Claude
- Claude's system prompt explicitly forbids using outside knowledge of the book
- If a book is recognized, Claude is instructed to ignore what it knows
- Chapters beyond your current position are grayed out and unselectable

## AI providers

Works with **Ollama** (free, local) or the **Anthropic API** (Claude). Configure in Settings.

<details>
<summary><strong>Developer setup</strong></summary>

1. **Clone the repo**
   ```bash
   git clone https://github.com/alex-potter/bookbuddy.git
   cd bookbuddy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Add your API key** (optional — Ollama works without one)

   Create `.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. **Start the dev server**
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

</details>

<details>
<summary><strong>Project structure</strong></summary>

```
app/
  page.tsx              — Main UI (upload → chapter select → dashboard)
  api/analyze/route.ts  — Server-side Claude API call
  layout.tsx / globals.css
components/
  UploadZone.tsx        — Drag-and-drop EPUB uploader
  ChapterSelector.tsx   — Chapter list + Analyze button
  CharacterCard.tsx     — Individual character display
lib/
  epub-parser.ts        — Client-side EPUB parsing (JSZip)
types/
  index.ts              — TypeScript interfaces
```

</details>

## License

[MIT](LICENSE)
