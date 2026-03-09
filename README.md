# Chapter Companion

> Track characters as you read an ebook — spoiler-free.

Upload any EPUB, tell the app which chapter you're on, and Claude analyzes **only the text you've already read** to give you a spoiler-safe character dashboard.

## Setup

1. **Install Node.js** — https://nodejs.org (LTS version)

2. **Install dependencies**
   ```bash
   cd ebook-tracker
   npm install
   ```

3. **Add your Anthropic API key** — edit `.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

4. **Start the dev server**
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

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

## Project structure

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

## Character card fields

Each card shows:
- **Status** — Alive / Dead / Unknown / Uncertain (with colored indicator)
- **Importance** — Main / Secondary / Minor
- **Current location** — Last known whereabouts
- **Description** — Who they are, as established so far
- **Recent events** — What's happened to them lately
- **Relationships** — Who they know and how (expandable)
- **Last seen** — Which chapter they most recently appeared in
