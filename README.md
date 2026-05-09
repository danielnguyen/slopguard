# ContextChecker

ContextChecker is a cross-browser extension that highlights low-transparency, engagement-driven YouTube content patterns before you click.

This is a personal, independent project. It is not affiliated with or endorsed by Mozilla.

> **Experimental notice:** ContextChecker is an experimental, local-first browser extension. Labels are heuristic or model-generated pattern indicators. They are not factual determinations, allegations, or claims that any creator, channel, publisher, sponsor, or platform has engaged in misconduct. See [`DISCLAIMER.md`](./DISCLAIMER.md) and [`LEGAL_NOTICES.md`](./LEGAL_NOTICES.md) before relying on or redistributing this project.

---

## What it does (v0.1)

- Scans YouTube pages (home, search, sidebar)
- Applies lightweight heuristic scoring and optional model-assisted classification
- Displays context badges for videos with notable presentation or transparency signals:
  - 🔴 Check sourcing
  - 🟡 Context needed
  - 🟡 Quick check
  - ⚪ Checking…
  - 🔵 Sponsored placement

The goal is not to decide truth, but to introduce friction before consuming potentially manipulative content.

---

## Classifier scope

ContextChecker does **not** determine whether a video is true, false, good, bad, biased, ethical, unethical, or worth watching.

It highlights videos whose public metadata suggests that extra source/context checking may be useful, especially for:

- current affairs
- politics and elections
- public health
- geopolitical or military claims
- economic or trade claims
- urgent, dramatic, or speculative source-sensitive framing
- visible sponsored placements

ContextChecker should be treated as a **source-transparency aid**, not a truth adjudicator, creator-rating system, or content quality score.

---

## Label meanings

Labels are intentionally cautious and diplomatic:

- **🔴 Check sourcing** — the metadata has stronger source-transparency or presentation-risk signals. This is a prompt to verify the claim, not a conclusion that the video is false.
- **🟡 Context needed** — the metadata suggests additional context may be useful before relying on the video.
- **🟡 Quick check** — a local lightweight check matched source-sensitive patterns, or an AI review could not complete. This is lower-confidence than a completed model-assisted review.
- **⚪ Checking…** — a model-assisted review has been queued and may update shortly.
- **🔵 Sponsored placement** — YouTube appears to mark the item as sponsored or promoted. This is an advertising-disclosure indicator, not a quality judgment.

Labels should never be interpreted as allegations of deception, misconduct, illegality, bad faith, misinformation, disinformation, or platform manipulation.

---

## Stabilization guardrails

ContextChecker should avoid becoming a personal taste filter or an endlessly expanding keyword dictionary.

Future scoring changes should be made cautiously and should generally meet at least one of these criteria:

- repeated obvious misses across several examples
- repeated harmful false positives against legitimate news, comedy, satire, or original reporting
- clear UX bug
- cost, rate-limit, or privacy issue
- legal/disclaimer wording issue
- generalizable source-transparency pattern, not a one-off dislike of a specific creator, channel, topic, or viewpoint

When in doubt, prefer routing borderline current-affairs content to review rather than hard-coding a final judgment.

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

ContextChecker does not try to determine truth.

It surfaces observable presentation and transparency signals such as:
- unclear sourcing
- emotional or sensational framing
- speculative claim patterns
- low-transparency or synthetic-style presentation cues
- visible sponsored-placement indicators

The goal is to help users notice patterns—not to control what they see.

---

## Disclaimer

ContextChecker is provided for personal, educational, and experimental use. It may be wrong. Its outputs should be treated as prompts for further review, not as conclusions. Do not use ContextChecker labels as proof of deception, misinformation, illegality, bad faith, or wrongdoing.

For more detail, see:

- [`DISCLAIMER.md`](./DISCLAIMER.md)
- [`LEGAL_NOTICES.md`](./LEGAL_NOTICES.md)

---

## License

TBD
