<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Testing preferences

- Run Impeccable tests, detectors, and design checks only when the user explicitly requests them.
- Prefer targeted checks for changed behavior: `npm run test:only -- tests/example.test.ts`. Always specify the relevant files.
- Keep routine validation small. Run the full suite or a production build only when the scope or an unresolved concern justifies it, or when requested.
- Consolidate overlapping cases while preserving meaningful security, playlist-save, playback, and provider-rate-limit coverage. Do not add tests for reversible copy or layout tweaks or tests that merely mirror implementation.
