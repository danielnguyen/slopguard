# Thumbnail Authenticity Review Plan

## Goal

Add cautious thumbnail authenticity and dramatization review support for current-affairs content.

## Planned metadata additions

Extend `VideoMetadata` with:

- `thumbnailUrl`
- `thumbnailAlt`
- `thumbnailContext`

## Planned UI labels

- `thumbnail_authenticity_unclear`
- `dramatized_or_recreated_visual`
- `synthetic_visual_style`
- `visual_claim_exceeds_metadata`

## Planned UX wording

Public badge examples:

- `🟡 Thumbnail context`
- `🟡 Visual context needed`

Tooltip wording should remain cautious and non-defamatory.

## Planned implementation

### content.ts

- Extract thumbnail image URL from YouTube cards
- Pass thumbnail URL to background worker
- Preserve existing sponsored detection

### background.ts

- Add thumbnail-aware OpenAI review path
- Use multimodal request payloads
- Restrict visual analysis to current-affairs content
- Preserve local-first fallback behavior
- Reuse existing queue/throttle/cache infrastructure

## Important constraints

- Do not determine truthfulness
- Do not accuse creators of deception
- Treat recreated, composited, AI-assisted, cinematic, or dramatized thumbnails as presentation context only
- Prefer source-transparency language over misinformation language
