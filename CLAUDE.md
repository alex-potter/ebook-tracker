# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
npm run dev              # Next.js dev server (localhost:3000)
npm run build            # Standard Next.js build (server mode)
npm run build:mobile     # Static export for Capacitor APK (strips API routes)
npm run cap:sync         # Build mobile + sync to Capacitor
npm run cap:android      # Build mobile + open Android Studio
npm run deploy:gh-pages  # Static export + deploy to GitHub Pages
```

The mobile build (`scripts/mobile-build.js`) temporarily removes `app/api/` before building, then restores it. This is because Capacitor needs a fully static export with no server routes.

There are no automated tests in this project.

## Architecture

BookBuddy is a Next.js 14 App Router application that tracks characters, locations, and narrative arcs as you read through an ebook. It runs in three deployment modes:

1. **Web server** (`npm run dev`): Next.js handles API routes server-side, Anthropic key in `.env.local`
2. **Android APK** (`npm run cap:android`): Static export in Capacitor WebView, AI calls made directly from browser, keys in localStorage
3. **GitHub Pages PWA** (`npm run deploy:gh-pages`): Static export with `/bookbuddy` base path

### Data flow

EPUBs are parsed entirely client-side (JSZip). Book state (snapshots, entities, chapter data) lives in **IndexedDB** (`lib/book-storage.ts`) with a tiny localStorage index for the book list. Cross-tab sync uses BroadcastChannel.

### Snapshot system

Analysis is incremental. The first chapter produces a full `AnalysisResult` (characters, locations, arcs, summary). Subsequent chapters produce deltas merged via `mergeDelta` in `lib/ai-shared.ts`. Each snapshot is stored by chapter index, allowing rollback to any prior state.

### AI provider abstraction

`lib/llm.ts` dispatches to Anthropic, Ollama, Gemini, OpenAI-compatible, or on-device llama.cpp. The server path (`app/api/analyze/route.ts`) uses Anthropic with the key from `.env.local`. The client path (`lib/ai-client.ts`) reads provider settings from localStorage and calls APIs directly from the browser.

On-device inference (`lib/local-llm.ts`) uses a Capacitor plugin (`LlamaPlugin.kt`) that bridges to native llama.cpp via JNI. Models are downloaded on demand with idle timeout unloading.

### Anti-spoiler design

System prompts forbid outside knowledge. Only text up to the reader's current chapter is sent. `lib/validate-entities.ts` drops hallucinated entities whose names don't appear in the actual chapter text.

### Entity reconciliation

`lib/reconcile.ts` detects duplicate entities (exact match, substring, Levenshtein distance <= 2) and proposes merges/splits. Accepted edits propagate retroactively across all historical snapshots via `lib/propagate-edit.ts`.

### Series/omnibus support

`lib/series.ts` handles multi-book EPUBs with per-book chapter bounds, exclusion lists, and series-wide arc groupings. Staleness detection triggers re-grouping when bounds change.

### Context window management

`lib/context-window.ts` estimates tokens at 3.5 chars/token, auto-detects Ollama context limits, and splits large chapters into overlapping chunks (500 char overlap).

## Key conventions

- `NEXT_PUBLIC_MOBILE=true` toggles static export mode in `next.config.js`
- `NEXT_PUBLIC_BASE_PATH` sets the asset prefix for GitHub Pages deployment
- `tsconfig.json` excludes `android/` to avoid TS errors from native code
- The Android project includes llama.cpp as a git submodule at `android/app/src/main/cpp/llama.cpp`
