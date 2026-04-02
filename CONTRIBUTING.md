# Contributing to clauditor

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/IyadhKhalfallah/clauditor.git
cd clauditor
npm install
npm test
npm run build
```

## Development workflow

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm test` and `npm run lint` — both must pass
4. Write a clear commit message using [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, etc.)
5. Open a pull request against `main`

## Rules

### No leaked source code

Do not reference, port, quote, or derive logic from any leaked or non-public Anthropic source code. This includes the March 2026 Claude Code source map incident or any other non-public disclosure.

### Attributable knowledge only

Every feature must be justifiable from one of:
- Claude Code's official documentation at [code.claude.com/docs](https://code.claude.com/docs)
- Anthropic's public API docs at [docs.anthropic.com](https://docs.anthropic.com)
- Community-documented behavior in public GitHub issues, Reddit, or blog posts
- Independent behavioral observation of the running tool

### Clean-room implementation

If you are unsure whether something you know came from leaked materials, do not contribute it. Describe the observed behavior instead and let a maintainer implement it independently.

## Testing

```bash
npm test          # Run all tests
npm run lint      # Type check
npm run build     # Build
```

Tests are in `src/**/*.test.ts` using Vitest.

## Architecture

clauditor has three layers:

1. **Hooks** (`src/hooks/`) — Claude Code hook handlers that run as separate processes
2. **Features** (`src/features/`) — Detection and analysis logic
3. **TUI** (`src/tui/`) — Ink-based dashboard (optional, not the core product)

The core value is in the hooks. The most important file is `src/hooks/post-tool-use.ts` — it handles session rotation blocking.

## Releases

Releases are automated via [Release Please](https://github.com/googleapis/release-please). Conventional commit messages determine version bumps:
- `fix:` → patch
- `feat:` → minor
- `feat!:` or `BREAKING CHANGE:` → major
