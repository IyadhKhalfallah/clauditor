<p align="center">
  <h1 align="center">clauditor</h1>
  <p align="center">
    <strong>Stop Claude Code from burning through your quota in 20 minutes.</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/@iyadhk/clauditor"><img src="https://img.shields.io/npm/v/@iyadhk/clauditor" alt="npm version"></a>
    <a href="https://github.com/IyadhKhalfallah/clauditor/actions"><img src="https://img.shields.io/github/actions/workflow/status/IyadhKhalfallah/clauditor/ci.yml?branch=main" alt="CI"></a>
    <a href="https://github.com/IyadhKhalfallah/clauditor/blob/main/LICENSE"><img src="https://img.shields.io/github/license/IyadhKhalfallah/clauditor" alt="MIT License"></a>
  </p>
</p>

---

## The problem

Every turn in a Claude Code session re-sends your entire conversation history to the API. A fresh session sends ~20k tokens per turn. A 200-turn session sends ~200k per turn. **Same work, 10x more quota.**

```
Turn    1: ██ 20k tokens
Turn   50: ██████████ 100k tokens
Turn  200: ████████████████████ 200k tokens
Turn  500: ██████████████████████████████████████████ 400k tokens
```

This is why your session limit gets hit in 20 minutes. Not because of a bug — because sessions grow linearly and nobody tells you to start fresh.

## The solution

clauditor monitors your session size and **blocks Claude when you're wasting quota**, saving your progress so you can start fresh without losing context.

```
╔══════════════════════════════════════════════════════════════╗
║  clauditor: Session using 9x more quota than necessary      ║
╚══════════════════════════════════════════════════════════════╝

This session is burning 9x more quota per turn (170k vs ~20k tokens/turn).
Your progress has been saved and won't be lost.

Run `claude` to start a fresh session at ~20k tokens/turn instead of 170k.
In the new session, just say "continue where I left off".
```

When you type "continue" in the new session, clauditor shows your saved sessions and tells you exactly what to type:

```
╔══════════════════════════════════════════════════════════════╗
║  clauditor: 2 recent sessions found                        ║
╚══════════════════════════════════════════════════════════════╝

  1. (5m ago) Notion backfill — populating database with User Email
     → read ~/.clauditor/sessions/.../1234.md and continue where I left off

  2. (30m ago) feat/variable-agent — migrating from ResponsesApi
     → read ~/.clauditor/sessions/.../5678.md and continue where I left off

Copy one of the → lines above, or type something else to start fresh.
```

## Install

```bash
brew install IyadhKhalfallah/clauditor/clauditor
clauditor install
```

Or via npm:

```bash
npm install -g @iyadhk/clauditor
clauditor install
```

That's it. Two commands. clauditor registers hooks into Claude Code and runs in the background. No dashboard needed. No config needed.

**Also works with npx** (no global install):

```bash
npx @iyadhk/clauditor install
```

Hooks are registered to run via npx automatically.

New hooks are auto-registered on upgrade — no need to re-run `clauditor install`.

Requires Node.js 20+.

**Supported platforms:** Claude Code CLI, VS Code extension, JetBrains extension. Does **not** work with Claude Code on the web (claude.ai/code).

**Known limitation:** The "continue" prompt block works reliably in the CLI. In the VS Code extension, the `UserPromptSubmit` hook [may not fire consistently](https://github.com/anthropics/claude-code/issues/17277) — context is still injected via `SessionStart` but Claude may not always announce it. This is a Claude Code bug, not a clauditor issue.

## How it works

clauditor registers 7 hooks into Claude Code:

### `UserPromptSubmit` — blocks before tokens are wasted

Before Claude processes your prompt, clauditor checks two things:

1. **Waste factor** — if the session is burning too much quota, it blocks with exit code 2.
2. **"Continue" detection** — if you type "continue", "resume", "pick up where I left off", etc., it blocks with your saved session choices and copyable prompts.

```
Waste factor = current tokens/turn ÷ baseline tokens/turn

  1x = efficient (fresh session)
  5x = growing
 10x = blocked — start fresh
```

### `PostToolUse` — blocks during autonomous work

When Claude is working autonomously (editing files, running commands), there's no user prompt to intercept. The PostToolUse hook catches this — after each tool call, it checks the waste factor and blocks if too high.

Uses exit code 2, which Claude Code treats as a blocking error. Claude acknowledges it, writes a handoff summary, and stops.

Also detects: cache degradation, token spikes, resume anomalies, edit thrashing, and **buggy Claude Code versions** (2.1.69-2.1.89 have a known cache bug that burns 10-20x tokens).

### `PreCompact` — saves context before compaction

Fires at the exact moment before Claude Code compacts your context. Saves session state as a fallback in case PostCompact doesn't fire.

### `PostCompact` — captures Claude's summary + mechanical state

Fires after compaction. Merges Claude's own LLM-generated summary with mechanically extracted structured data (files, commits, commands) from the JSONL transcript.

### `SessionStart` — injects previous session context

When you start a new session, clauditor reads saved handoff files for this project and injects them into Claude's context. If multiple sessions exist (last 24h), Claude presents the choice.

### `PreToolUse` — prevents known errors

Before Claude runs a command, clauditor checks the local error index (and optionally the team hub) for previous failures with the same binary. If a known fix exists with sufficient confidence, it injects it as context — non-blocking, so Claude can adapt without being stopped.

```
[clauditor]: `npm run build` has failed 5 times on this project.
Last error: Module not found: Cannot resolve @/lib/db
Known fix: `npx drizzle-kit push && npm run build`
```

If the command succeeds after the warning, confidence increases. If it fails despite the warning, confidence decreases. The knowledge base self-corrects over time.

### `Stop` — blocks infinite loops

When Claude repeats the same tool call 3+ times with identical input and output, the Stop hook blocks it.

## Real data

From a real user's Claude Code usage over 7 days:

```
  TURNS  BASE   NOW   WASTE  TOKENS
  ──────────────────────────────────────────────────────────
    317   21k  417k  20.1x    73M  ████████████████████
    576   28k  401k  14.5x   116M  ███████████████
    172   23k  249k    11x    25M  ███████████
    164   26k  220k   8.6x    21M  █████████
    230   28k  218k   7.8x    31M  ████████
    ...
  ──────────────────────────────────────────────────────────
  37 sessions · 418M tokens total
  15 sessions burned 5x+ more quota than necessary

  clauditor impact
  With rotation on all sessions: 157M tokens instead of 418M
  Potential savings: 261M tokens (62% less quota)
```

## Dashboard (optional)

```bash
clauditor watch
```

```
── clauditor ──  4 sessions + 3 subagents (last 12h)

 LAST 7 DAYS
 37 sessions · 15 burned 5x+ quota
 Worst: api/service (317 turns, 20.1x waste — 21k→417k/turn)
 With rotation: 157M tokens instead of 418M (62% savings)

 api-service (feat/variable-agent)  opus-4-6 · 239 turns

 Waste factor: 8x  BLOCKED — start a fresh session
 ██████████████████████████████
 Started at 20k/turn → now 153k/turn (8x more quota per turn)

 Cache: 98%  Turns: 239  ~$64 API est.
```

## Peak vs off-peak analysis

```bash
clauditor time
```

Shows token costs by hour of day to detect if peak hours burn more quota:

```
  Token Usage by Hour — last 7 days
  ──────────────────────────────────────────────────────────
  10:00    98k/turn   304 turns  cache  92%  ███████████
  14:00   124k/turn   289 turns  cache  96%  ██████████████
  18:00   164k/turn   275 turns  cache  98%  ██████████████████
  ──────────────────────────────────────────────────────────
  Peak (9am-5pm):    114k avg tokens/turn
  Off-peak:          154k avg tokens/turn
```

## All commands

| Command | Description |
|---|---|
| `clauditor` | Show quota report (default) |
| `clauditor install` | Register hooks into Claude Code (one-time) |
| `clauditor uninstall` | Remove hooks |
| `clauditor watch` | Live dashboard showing waste factor |
| `clauditor report` | Quota usage report with waste bars |
| `clauditor share` | Copy-pasteable summary for social media |
| `clauditor time` | Token usage by hour of day (peak vs off-peak) |
| `clauditor sessions` | See where your tokens went |
| `clauditor status` | Quick health check (no TUI) |
| `clauditor impact` | Lifetime stats |
| `clauditor activity` | Recent actions log |
| `clauditor stats` | Historical usage analysis |
| `clauditor doctor` | Scan for cache bugs |
| `clauditor calibrate` | Auto-calibrate rotation threshold |
| `clauditor suggest-skill` | Find repeating workflows |
| `clauditor knowledge` | Show accumulated errors and file activity |
| `clauditor handoff-report` | Measure information preservation of last session handoff |
| `clauditor team join` | Connect to a clauditor hub for team knowledge sharing (beta) |

## Audit-only mode (no hooks)

Don't want clauditor to block or modify your sessions? Skip `clauditor install` and use it as a read-only analytics tool:

```bash
brew install IyadhKhalfallah/clauditor/clauditor
# or: npm install -g @iyadhk/clauditor
clauditor report      # see waste across all sessions
clauditor time        # peak vs off-peak token analysis
clauditor sessions    # per-session breakdown
clauditor doctor      # scan for cache bugs
clauditor share       # copy-pasteable summary
```

These commands read your session JSONL files directly. No hooks registered, no session modifications, no side effects.

## Works alongside other tools

clauditor operates at the **session boundary** layer — it monitors waste and rotates sessions. Other tools work at different layers and are fully compatible:

| Tool | Layer | What it does | Conflicts? |
|---|---|---|---|
| [Headroom](https://github.com/chopratejas/headroom) | API proxy | Compresses tool output tokens (~34% savings per turn) | No — works at HTTP level |
| [MemStack](https://github.com/cwinvestments/memstack) | Persistent memory | SQLite + vector DB for cross-session knowledge | No — uses skills + rules |
| [Claude Workspace Optimizer](https://oakenai.tech/tools/claude-workspace-optimizer) | Static workspace | Audits CLAUDE.md and memory files for bloat | No — runs before sessions |
| [GrapeRoot](https://github.com/nicobailon/graperoot) | Per-turn context | Builds code graph, pre-loads relevant files | No — complementary |
| [Hippo Memory](https://github.com/kitfunso/hippo-memory) | Persistent memory | Neuroscience-inspired memory with decay | No — different approach |

You can run all of them together. clauditor handles when to rotate; the others optimize what happens within a session.

## Configuration

Everything works out of the box. One config file at `~/.clauditor/config.json`:

```json
{
  "rotation": {
    "enabled": true,
    "threshold": 100000,
    "minTurns": 30
  },
  "notifications": {
    "desktop": true
  }
}
```

| Setting | Default | Description |
|---|---|---|
| `rotation.enabled` | `true` | Enable/disable session rotation |
| `rotation.threshold` | `100000` | Tokens/turn average to trigger block |
| `rotation.minTurns` | `30` | Minimum turns before blocking |
| `notifications.desktop` | `true` | Desktop notifications for cache issues |

Created automatically on `clauditor install`. Edit to customize.

## How it saves context

clauditor combines two methods to maximize information preservation during session rotation.

### Structured handoff template

When clauditor blocks a session for rotation, it tells Claude to write its handoff in a structured format:

```
TASK: (what you were working on)
COMPLETED: (what's done)
IN_PROGRESS: (what's partially done, with file paths)
FAILED_APPROACHES: (what was tried and didn't work, and WHY)
DEPENDENCIES: (things that must happen in order)
DECISIONS: (choices made and why)
USER_PREFERENCES: (what the user asked for or rejected)
BLOCKERS: (unresolved issues)
```

This captures what only Claude knows — reasoning, rejected approaches, conditionals — in a parseable format. The parser detects structured output (2+ section headers) and falls back to prose if Claude doesn't follow the template.

### Mechanical extraction

Every handoff also includes structured data extracted mechanically from the JSONL transcript:

- Files modified and read
- Git commits (verbatim messages)
- Key commands and results (builds, tests, deploys)
- Recent user messages

This data is deterministic — no LLM interpretation, no paraphrasing, no loss.

### Why both?

Research shows LLM-generated summaries suffer from knowledge overwriting and semantic drift ([Size-Fidelity Paradox](https://arxiv.org/abs/2602.09789)). Mechanical extraction preserves files and commits deterministically. Claude's prose captures reasoning the transcript can't. Together they give the next session the best possible starting point.

```bash
clauditor handoff-report   # see what your last handoff contains
```

```
  Structural Coverage
  ────────────────────────────────────────────────────

  Score:  73% (11/15 structural items in handoff)

  Files modified         2/4  ██████████░░░░░░░░░░
  Commits                2/2  ████████████████████
  Files read             3/5  ████████████░░░░░░░░
  Commands               2/2  ████████████████████
```

### Per-session storage

Each handoff is saved as a separate timestamped file:

```
~/.clauditor/sessions/<encoded-project-path>/<timestamp>.md
```

Multiple sessions in the same project don't overwrite each other. Files older than 24h are cleaned up automatically.

### Session resume flow

1. clauditor blocks your session (or `/compact` fires)
2. Context is saved — structured template + mechanical data
3. You open a new session and type "continue"
4. clauditor blocks with your saved sessions and copyable prompts
5. You paste the prompt — Claude reads the file and picks up where you left off

## Project memory

clauditor learns from your sessions and builds per-project knowledge at `~/.clauditor/knowledge/<project>/`.

**Error index with confidence decay** — Records failed commands and their fixes. Each error has a confidence score (0–1) that decays with a 45-day half-life. Recent errors rank above old ones. Stale errors fade naturally instead of accumulating forever.

```
  npm run build          conf=0.85  (confirmed, 5x)
  npx drizzle-kit push   conf=0.30  (inferred, 1x)
```

**Noise filtering** — Typo commands (`command not found`), transient network errors (`ETIMEDOUT`), and tiny error messages are filtered at capture time. Keeps the error index clean from day one.

**Implicit outcome tracking** — When `PreToolUse` warns about a command and `PostToolUse` sees the result, confidence adjusts automatically. Command succeeded after warning? +0.1. Failed despite warning? -0.15. Self-correcting, zero effort.

**Confidence tiers** — Errors are labeled `confirmed` (0.7+), `observed` (0.4+), `inferred` (0.2+), or `stale` (<0.2). Claude sees the tier in the injection, so it knows how much to trust each entry.

**File tracker** — Tracks edit/read counts across sessions. Identifies "hot files" (5+ edits across 3+ sessions) and injects context when Claude touches them, so it knows the file's history.

```bash
clauditor knowledge   # see accumulated errors and file activity
```

## Team knowledge sync (optional, beta)

For teams, clauditor can optionally connect to a hub for shared knowledge:

```bash
clauditor team join --key <API_KEY> --hub-url https://your-hub.com
```

When connected:
- **PreToolUse** queries the hub before Bash commands — team errors and fixes are shared
- **PostToolUse** pushes error fragments to the hub and queries for file context
- **SessionStart** pulls a compact team knowledge brief

Knowledge starts as developer-scoped and auto-promotes to team-scoped when multiple developers report the same issue. No hub required for solo use — all local features work independently.

## Cross-project session handoffs

Session handoffs work across projects. If you save a session in project A and open project B, clauditor finds it. Cross-project sessions show `[project-name]` labels so you know where they came from.

## Version-aware warnings

clauditor detects if your sessions ran on Claude Code versions 2.1.69-2.1.89, which have a [confirmed prompt caching bug](https://github.com/anthropics/claude-code/issues/34629) that causes 10-20x token consumption. The warning appears in `clauditor report` and via real-time hooks.

## Technical details

**Why sessions get expensive:**

Every Claude Code API call sends: `tools` → `system prompt` → `CLAUDE.md` → `conversation history`. The conversation history grows linearly. Cache makes the prefix cheap (cache_read), but the growing tail requires cache_create each turn.

```
API call = tools (cached) + system (cached) + history (grows every turn)
```

After 200 turns, the history alone can be 200k+ tokens. A fresh session resets this to near zero.

**What clauditor monitors:**

| Metric | Source | Formula |
|---|---|---|
| Tokens/turn | JSONL `usage` field | `input + output + cache_read + cache_create` |
| Baseline | First 5 turns of session | Average tokens/turn |
| Current | Last 5 turns of session | Average tokens/turn |
| Waste factor | Derived | `current ÷ baseline` |
| Cache ratio | JSONL `usage` field | `cache_read ÷ (input + cache_read + cache_create)` |

**Hook communication:**

| Hook | Mechanism | Why |
|---|---|---|
| `UserPromptSubmit` | Exit code 2 + stderr | Hard block — stops prompt, shows message |
| `PostToolUse` | Exit code 2 + stderr | Blocking error — Claude acknowledges and stops |
| `PreToolUse` | `additionalContext` | Injects known error fixes before commands |
| `PreCompact` | File write | Saves fallback state at compaction moment |
| `PostCompact` | File write | Captures Claude's own LLM summary |
| `SessionStart` | `additionalContext` | Injects previous session state |
| `Stop` | `decision: "block"` | Prevents infinite loops |

## Limitations

- **Cannot reduce Claude Code's context assembly.** We observe and advise — we don't modify what Claude Code sends to the API.
- **Cannot see quota.** Anthropic doesn't expose quota data. The waste factor is a proxy based on token growth.
- **Cache reads may or may not count toward quota.** The exact quota accounting for Max plan subscribers is not published.
- **Web sessions not supported.** Only CLI and IDE extensions write local JSONL files.
- **Per-device only.** Sessions don't sync across machines.
- **VS Code UserPromptSubmit limitation.** The "continue" prompt block works in CLI but [may not fire in VS Code](https://github.com/anthropics/claude-code/issues/17277). Context is still injected via SessionStart.

## Development

```bash
git clone https://github.com/IyadhKhalfallah/clauditor.git
cd clauditor
npm install
npm test        # 275 tests
npm run build
npm link        # makes `clauditor` available globally
```

## Legal

MIT License. Not affiliated with or endorsed by Anthropic.

- No leaked source code was referenced or used
- All features derived from official docs, public community discussions, and independent observation
- "clauditor" = "Claude" + "auditor", used in a descriptive, nominative sense

## Contributing

Contributions welcome. Rules:

- **No leaked source code.** Do not reference or derive logic from non-public Anthropic code.
- **Attributable knowledge only.** Official docs, public GitHub issues, community posts, or independent observation.
- **Clean-room implementation.** If unsure about a knowledge source, don't contribute it.

## License

MIT
