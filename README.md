# SlopGuard

SlopGuard is a cross-browser extension that highlights low-transparency, engagement-driven YouTube content patterns before you click.

This is a personal, independent project. It is not affiliated with or endorsed by Mozilla.

> **Experimental notice:** SlopGuard is an experimental, local-first browser extension. Labels are heuristic or model-generated pattern indicators. They are not factual determinations, allegations, or claims that any creator, channel, publisher, sponsor, or platform has engaged in misconduct. See [`DISCLAIMER.md`](./DISCLAIMER.md) and [`LEGAL_NOTICES.md`](./LEGAL_NOTICES.md) before relying on or redistributing this project.

---

## What it does (v0.1)

- Scans YouTube pages (home, search, sidebar)
- Applies lightweight heuristic scoring and optional model-assisted classification
- Displays context badges for videos with notable presentation or transparency signals:
  - 🔴 Low-transparency risk
  - 🟡 Check sourcing
  - 🟠 High-engagement framing
  - 🔵 Sponsored placement

The goal is not to decide truth, but to introduce friction before consuming potentially manipulative content.

---

## Tech Stack

- TypeScript
- Vite
- WebExtensions (Chrome + Firefox)

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

It surfaces observable presentation and transparency signals such as:
- unclear sourcing
- emotional or sensational framing
- speculative claim patterns
- low-transparency or synthetic-style presentation cues
- visible sponsored-placement indicators

The goal is to help users notice patterns—not to control what they see.

---

## Disclaimer

SlopGuard is provided for personal, educational, and experimental use. It may be wrong. Its outputs should be treated as prompts for further review, not as conclusions. Do not use SlopGuard labels as proof of deception, misinformation, illegality, bad faith, or wrongdoing.

For more detail, see:

- [`DISCLAIMER.md`](./DISCLAIMER.md)
- [`LEGAL_NOTICES.md`](./LEGAL_NOTICES.md)

---

## License

TBD
