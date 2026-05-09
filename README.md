<p align="center">
  <a href="https://alex-potter.github.io/bookbuddy/">
    <img src="docs/brand/banner-light.svg" alt="BookBuddy — a spoiler-safe reader's companion" width="100%" />
  </a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-c19024?style=flat&labelColor=2c2319" alt="MIT License"></a>
  <a href="https://alex-potter.github.io/bookbuddy/"><img src="https://img.shields.io/badge/demo-live-4f7579?style=flat&labelColor=2c2319" alt="Live demo"></a>
  <img src="https://img.shields.io/badge/PWA-ready-b5542b?style=flat&labelColor=2c2319" alt="PWA ready">
  <img src="https://img.shields.io/badge/Android-APK-c19024?style=flat&labelColor=2c2319&logo=android&logoColor=faf5e8" alt="Android APK">
</p>

---

## What it does

Drop in an EPUB, tell BookBuddy how far you've read, and it builds a living dashboard around the book — bounded strictly by what you've actually read.

- **Characters** — relationships, status, current location, recent events
- **Locations** — descriptions plus an interactive **map** with pinned places
- **Arcs** — every plot thread tracked through the chapters, including arcs that span an entire series
- **Timeline & subway map** — see who was where, when
- **Chat** — ask spoiler-free questions about anything in the read range
- **Bookmarks** — scrub to any past chapter and the dashboard rewinds with you

Anti-spoiler is a first-class concern. The EPUB is parsed in your browser, only text up to your current chapter is sent to the model, the system prompt forbids using outside knowledge of the book, and chapters past your bookmark are blurred until you read past them.

---

## Try it without an EPUB

The fastest way to see BookBuddy in action is to open a book someone else has already analyzed.

**[Open the live app →](https://alex-potter.github.io/bookbuddy/)**

On the start screen, switch to the **Library** tab. Pick any title — it loads in seconds with the full analysis baked in. Step through the chapters; the dashboard rewinds and fast-forwards with you, no AI key required.

The community library lives in [`books/`](books/) in this repo. To add to it, see [Submit a book](#5-submit-it-back-to-the-library) below.

---

## Bring your own book

Five steps. The first three you do once; the fourth runs in the background.

### 1. Drop in an EPUB

Open the **Upload EPUB** tab and drag a `.epub` onto the drop zone (or tap to browse). The file is unzipped and parsed entirely in your browser — nothing leaves your machine. On desktop, the **Calibre** tab can pull books straight from a local Calibre library.

Public-domain books from [Project Gutenberg](https://www.gutenberg.org/) and [Standard Ebooks](https://standardebooks.org/) are great places to start.

### 2. Define the book's structure

The first time BookBuddy opens an EPUB, it shows you the **Book Structure Editor**. EPUBs are messy — every publisher slices them differently — so you tell BookBuddy:

- Which entries are real **story** chapters
- Which are **front-matter** (cover, copyright, table of contents) or **back-matter** (acknowledgements, appendices, ads)
- For an **omnibus** or boxed set — where each book starts and ends

For most single novels, it auto-detects everything and you just hit **Confirm**. For omnibus editions, drag the dividers so each book covers the right chapter range, then confirm. You only do this once per book.

This step matters: front-matter and back-matter are excluded from analysis, and per-book bounds drive the **series-wide arcs** view.

### 3. Process the book *(recommended: all at once)*

Once the structure is confirmed, switch to the **My Books** tab. Each book has a **+** button that adds it to the **processing queue** — a background runner that crunches every remaining chapter in order.

- Press **+** on a single book, or **+ Queue all unfinished** to batch every saved book
- The queue keeps running while you browse, switch tabs, or leave the page open
- Each chapter is checkpointed — close the tab, come back later, pick up where it stopped

**Why up-front?** The analysis is incremental: each chapter's snapshot builds on the previous one. Doing the whole book ahead means you can:

- Read offline (or on a flight) with the dashboard already populated
- Scrub instantly between any two chapters
- Get the most consistent character and arc tracking, since reconciliation runs across every snapshot at the end

With a fast local model (`qwen2.5:14b` on Ollama) or the Anthropic API, a 30-chapter novel typically finishes in a few minutes.

#### Chapter-by-chapter mode

You can also pick a chapter, hit **Analyze**, and get just that chapter's deltas. This is the mode to use if:

- You're on the **Android app with a Claude / cloud LLM subscription** and prefer to spend tokens chapter-by-chapter as you read, rather than burning a long-running batch up front
- You're sampling a book and not sure you'll finish it
- You want to watch how the analysis evolves as the story unfolds

Both modes share the same on-disk format — switch freely. No analysis is wasted.

### 4. Read the dashboard

As you advance the chapter selector, characters appear, locations get pinned to the map, and arcs extend. Tap any card for the full modal. Use the **search FAB** to jump to any entity globally, or open **Chat** to ask questions ("who is the cloaked figure from chapter 7?") that are answered using only what you've read.

### 5. Submit it back to the library

If your book is public domain or one you own, share the analysis so other readers can skip steps 1–3.

1. Open **My Books**
2. Click the **↑** button next to the book
3. Download the generated ZIP and drop it onto the GitHub issue that auto-opens
4. A maintainer turns the issue into a pull request

Behind the scenes, BookBuddy generates a `.bookbuddy` file: pure JSON containing only the analysis (characters, locations, arcs, snapshots, map state). It contains **no EPUB text** and no copyrighted content from the source book.

---

## AI providers

Configure in **Settings**. All providers work in both web and Android builds.

| Provider | Best for |
|---|---|
| **Anthropic** (Claude Haiku / Sonnet / Opus) | Highest quality, fastest cloud option |
| **Ollama** (qwen2.5, llama3.1, gemma3, mistral) | Free, fully local, totally private |
| **OpenAI-compatible** | LM Studio, vLLM, OpenRouter, anything speaking the OpenAI API |
| **Gemini** | Google's API |
| **On-device llama.cpp** *(Android only)* | Runs a quantized GGUF on the phone — no network at all |

The Android build ships a native llama.cpp module. Pick a model in Settings, it downloads on demand, unloads when idle.

---

## Install it

It's a PWA — on the [live site](https://alex-potter.github.io/bookbuddy/), browsers offer to install it directly. For the Android APK, see the developer setup below.

---

## Developer setup

```bash
git clone https://github.com/alex-potter/bookbuddy.git
cd bookbuddy
npm install
```

Optional, only needed if you want the Next.js server to make Anthropic calls on your behalf:

```
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

Common scripts:

```bash
npm run dev              # Next.js dev server on localhost:3000
npm run build            # Standard Next.js build (server mode)
npm run build:pwa        # Static export for GitHub Pages
npm run deploy:gh-pages  # Build + push to gh-pages
npm run cap:android      # Build mobile + open Android Studio
```

The mobile build temporarily strips `app/api/` (Capacitor needs a fully static export with no server routes), then restores it.

A short architecture tour lives in [CLAUDE.md](CLAUDE.md). The high-level layout:

```
app/                Next.js App Router (page.tsx is the main UI)
components/         Dashboard, modals, processing queue, library
lib/                EPUB parsing, AI clients, snapshot merge logic, IndexedDB storage
books/              Community-submitted .bookbuddy / .etbook files
android/            Capacitor + native llama.cpp module (git submodule)
```

---

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Book submissions go through the in-app flow described above. Bug reports and ideas live in the [issue tracker](https://github.com/alex-potter/bookbuddy/issues).

## License

[MIT](LICENSE)
