# Development workflow

ContextChecker now uses a lightweight branch-and-PR workflow.

## Branch rules

- `main` is the stable branch.
- Do not push feature work directly to `main`.
- Create a short-lived branch for each change, for example:
  - `fix/sponsored-label-placement`
  - `feature/details-popover`
  - `docs/classifier-policy`
  - `devops/ci-artifacts`

## Pull requests

Every pull request should stay small and focused.

Before merging, the GitHub Actions build should pass:

- dependency install
- TypeScript typecheck
- production build
- Chrome extension package
- Firefox extension package

The PR workflow uploads unsigned ZIP artifacts for manual testing:

- `context-checker-chrome`
- `context-checker-firefox-unsigned`

## Manual testing

### Chrome / Chromium

Chrome can load the unpacked build locally:

```bash
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

```text
dist/chrome
```

### Firefox

For local development, prefer:

```bash
npm run build
npx web-ext run --source-dir dist/firefox
```

Firefox release ZIPs produced by CI are unsigned. They are useful as build artifacts, but normal stable Firefox may reject permanent installation of unsigned extensions. For local testing, `web-ext run` is the most reliable path.

## Releases

Releases are intentionally manual.

Create a tag when a build is worth publishing:

```bash
git tag v0.1.0
git push origin v0.1.0
```

A release workflow will build the extension and attach packaged Chrome and Firefox ZIPs to a GitHub prerelease.

## Change discipline

Avoid tuning the classifier based on one-off examples. Prefer changes that address:

- repeated obvious misses across several examples
- repeated harmful false positives
- UX bugs
- cost/rate-limit/privacy issues
- legal/disclaimer wording issues
- generalizable source-transparency patterns
