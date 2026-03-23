# Contributing to BookBuddy

Thanks for your interest in contributing!

## Quick Start

```bash
git clone https://github.com/alex-potter/bookbuddy.git
cd bookbuddy
npm install
```

Create a `.env.local` file with your Anthropic API key (optional — Ollama works without one):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Start the dev server:

```bash
npm run dev
```

Open http://localhost:3000.

## Guidelines

- **Focused PRs** — one feature or fix per pull request.
- **Tailwind CSS** — use the existing utility-class style; avoid custom CSS unless necessary.
- **Test both AI paths** — features should work with both Ollama (local) and the Anthropic API.
- **No spoilers in test data** — use public-domain books for testing when possible.

## Reporting Bugs

Open an issue with:

1. What you expected to happen
2. What actually happened
3. Steps to reproduce
4. Browser and OS
