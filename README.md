# SlopGuard

SlopGuard is a cross-browser extension that highlights low-transparency, engagement-driven YouTube content patterns before you click.

This is a personal, independent project. It is not affiliated with or endorsed by Mozilla.

---

## What it does (v0.1)

- Scans YouTube pages (home, search, sidebar)
- Applies lightweight heuristic scoring
- Displays a warning badge on suspicious videos:
  - 🔴 Slop risk
  - 🟡 Check content

The goal is not to decide truth, but to introduce friction before consuming potentially manipulative content.

---

## Tech Stack

- TypeScript
- Vite
- WebExtensions (Chrome + Firefox)
- webextension-polyfill

---

## Getting Started

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

---

## Run locally

### Chrome / Chromium

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `dist/chrome`

### Firefox

```bash
npx web-ext run --source-dir dist/firefox
```

---

## Project Structure

```
src/
  content/        # YouTube DOM scanning + UI
  background/     # background worker
  scoring/        # heuristic scoring
options/          # settings UI
manifests/        # browser-specific manifests
scripts/          # build helpers
```

---

## Roadmap

- OpenAI classification (user-provided API key)
- Result caching
- Sensitivity controls
- Optional blocking mode
- Provider abstraction (OpenAI → others)

---

## Philosophy

SlopGuard does not try to determine truth.

It surfaces signals such as:
- lack of sources
- emotional framing
- speculative claims

The goal is to help users notice patterns—not to control what they see.

---

## License

TBD
