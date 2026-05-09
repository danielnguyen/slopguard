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
- Chromium extension package
- Firefox unsigned XPI package

The PR workflow uploads unsigned artifacts for manual testing:

- `context-checker-chromium`
  - contains `context-checker-chromium.zip`
- `context-checker-firefox-unsigned-xpi`
  - contains `context-checker-firefox-unsigned.xpi`

## Manual testing

### Chrome / Chromium / Edge / Brave

Chromium-family browsers can load the unpacked build locally:

```bash
npm run build
```

Then open the browser's extension management page, enable Developer mode, choose **Load unpacked**, and select:

```text
dist/chrome
```

The CI artifact `context-checker-chromium.zip` is a ZIP of the Chromium build. For manual testing, download it, unzip it locally, then load the unpacked folder.

A signed `.crx` package is intentionally not generated yet. CRX packaging adds signing-key management and is not needed for the lightweight development workflow.

### Firefox

For local development, prefer:

```bash
npm run build
npx web-ext run --source-dir dist/firefox
```

The CI artifact `context-checker-firefox-unsigned.xpi` is an unsigned Firefox package. It is useful as a build artifact, but normal stable Firefox may reject permanent installation of unsigned extensions. For local testing, `web-ext run` is the most reliable path.

## Releases

Releases are intentionally manual.

Create a tag when a build is worth publishing:

```bash
git tag v0.1.0
git push origin v0.1.0
```

A release workflow will build the extension and attach packaged Chromium and Firefox artifacts to a GitHub prerelease:

- `context-checker-chromium.zip`
- `context-checker-firefox-unsigned.xpi`

## Change discipline

Avoid tuning the classifier based on one-off examples. Prefer changes that address:

- repeated obvious misses across several examples
- repeated harmful false positives
- UX bugs
- cost/rate-limit/privacy issues
- legal/disclaimer wording issues
- generalizable source-transparency patterns
