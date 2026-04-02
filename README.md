# clauditor

> Session health monitoring for Claude Code — keep your sessions fast and your context intact.

clauditor is an open-source background daemon that monitors your Claude Code sessions. It **automatically** prevents the most common problems: broken cache draining your quota, loops wasting your time, and compaction erasing your context.

**Install it, forget it exists. It prevents problems.**

It reads Claude Code's local JSONL session files and integrates with the official [hooks system](https://docs.anthropic.com/en/docs/claude-code/hooks).

**It does not intercept network traffic, spoof the Claude Code harness, or violate Anthropic's ToS.**

**Supported platforms:** Claude Code CLI (`claude`), VS Code extension, JetBrains extension. Does **not** work with Claude Code on the web (claude.ai/code) — the web version doesn't write local session files or support hooks.

## Install

```bash
npm install -g @iyadhk/clauditor
```

Requires Node.js 20+.

## Quick start

```bash
# Register hooks into Claude Code (one-time setup)
clauditor install

# That's it. Hooks run automatically in the background.
# To verify it's working, run the dashboard:
clauditor watch
```

## What it does (automatically, after install)

clauditor registers three hooks into Claude Code that act **without any user intervention**:

### 1. Pre-compaction context save

The #1 complaint from Claude Code users: "Claude forgets everything after compaction." When your context window hits 95%, clauditor instructs Claude to save key decisions, file changes, and task status to CLAUDE.md **before** compaction erases them. Next session, Claude reads CLAUDE.md automatically — zero re-explaining.

### 2. Loop blocker

When Claude repeats the same tool call 3+ times with identical results, the Stop hook blocks it and tells Claude to try a different approach. Prevents burning tokens on repeated failures.

### 3. Edit thrashing detector

When Claude edits the same file 5+ times in one session, clauditor tells it to stop and explain its approach to the user before making more changes. Prevents "rushing through everything" — Claude steps back and thinks about the design instead of iterating blindly.

### 4. Session start health briefing

When you start Claude Code, clauditor checks your recent sessions for issues (broken cache, resume anomalies) and injects a health briefing into Claude's context. Claude starts each session aware of potential problems.

### 5. Cache degradation warning

Detects when `cache_read` stays flat while `cache_creation` grows — meaning your conversation is being reprocessed from scratch each turn (10-20x more expensive/slower). Injects a warning into Claude's context with the fix.

### 6. Resume anomaly detection

Detects two known bugs with `--resume` and `--continue`:

- **Token explosion** ([#38029](https://github.com/anthropics/claude-code/issues/38029)): 652K+ output tokens generated silently on resume
- **Cache invalidation** ([#40524](https://github.com/anthropics/claude-code/issues/40524)): resume breaks prompt cache entirely

### 7. Bash output compression

Compresses verbose bash output (npm install logs, build progress, progress bars) to reduce token waste. Strips noise, keeps errors.

## Dashboard (`clauditor watch`)

Run `clauditor watch` to see your sessions in real-time. Useful for verifying clauditor is working, or for monitoring a long session.

```
── clauditor ──

 RECENT SESSIONS (16)

    api-service (feat/agentic-file  healthy    679 turns  just now
    ↳ (a8) Search the web for dev…  healthy     75 turns  1h ago
    ↳ (ac) Compare implementation…  degraded   197 turns  5h ago

 api-service (feat/agentic-file-operations)  opus-4-6  679 turns
 /Users/alice/projects/api-service

 CACHE HEALTH

  Turn 676: ████████████████████ 100% ✓
  Turn 677: ████████████████████ 100% ✓
  Turn 678: ████████████████████ 100% ✓
  Turn 679: ████████████████████ 100% ✓

  Status: ✓ healthy

 SESSION HEALTH

  Context window: 29% (289k / 1M tokens)
  Cache efficiency: 100% (fast responses)
  Burn rate: 14k tokens/min (normal)
  Output: 140,803 tokens   679 turns this session

 API cost estimate: ~$514.25 · saved ~$992.53 by cache

 ALERTS

  All clear — session is healthy.

 RECENT ACTIVITY

  2m ago     ⚡ Injected cache warning — ratio at 12%
  15m ago    🛑 Blocked loop — Bash call(s) repeated 4x
  3h ago     📦 Compressed bash output: 12.4k → 1.8k chars

 Press q to quit
```

- Sessions labeled by **project name, git branch, and subagent task** — not cryptic IDs
- Model-aware context limits (200k for Sonnet, 1M for Opus)
- Real-time updates as Claude Code writes to session files
- Press `q` to quit

## Impact tracking

```bash
clauditor impact
```

See what clauditor has done for you — all numbers provable from your JSONL session data:

```
clauditor impact
───────────────────────────────────────────────────────
  Monitoring since: 4/2/2026  (7 days)
  Sessions monitored: 107
  Total turns tracked: 8,421

  SESSION HEALTH
  ──────────────
  Healthy sessions:     87%
  Average cache ratio:  94.2%

  ISSUES CAUGHT
  ─────────────
  3 cache degradations     — sessions reprocessing context from scratch
  1 loop blocked           — Claude retrying the same failing action
  2 context saves          — saved progress before compaction

  Total: 6 issues caught across 107 sessions
```

## All commands

| Command | Description |
|---|---|
| `clauditor install` | Register hooks into Claude Code (one-time) |
| `clauditor uninstall` | Remove hooks |
| `clauditor watch` | Live TUI dashboard |
| `clauditor status` | Quick one-line health check (no TUI) |
| `clauditor impact` | Lifetime stats — what clauditor has caught |
| `clauditor activity` | Recent actions log |
| `clauditor stats` | Historical usage analysis (7 days default) |
| `clauditor doctor` | Scan recent sessions for cache bugs |
| `clauditor check-memory` | Audit CLAUDE.md token footprint and quota impact |

### Options

```bash
clauditor watch --project ./my-project   # Watch a specific project
clauditor watch --all                    # Watch all projects
clauditor status --json                  # Machine-readable health check
clauditor stats --days 30                # Stats for last 30 days
clauditor stats --json                   # Machine-readable stats
clauditor doctor --json                  # Machine-readable diagnostics
clauditor impact --json                  # Machine-readable impact stats
clauditor activity --json                # Machine-readable activity log
clauditor activity -n 50                 # Show last 50 events
```

## Configuration

Create a `.clauditorrc` file in your project or home directory:

```json
{
  "pricing": {
    "model": "claude-sonnet-4-6",
    "inputPerMillion": 3.00,
    "outputPerMillion": 15.00,
    "cacheCreationPerMillion": 3.75,
    "cacheReadPerMillion": 0.30
  },
  "alerts": {
    "cacheBugThreshold": 3,
    "loopDetectionThreshold": 3,
    "claudeMdTokenWarning": 4000,
    "desktopNotifications": true
  },
  "bashFilter": {
    "enabled": true,
    "maxOutputChars": 2000,
    "preservePatterns": ["error", "warn", "fail", "exception"]
  },
  "watch": {
    "projectsDir": "~/.claude/projects",
    "pollInterval": 1000
  }
}
```

Also supports `clauditor.config.js`, `clauditor.config.ts`, or a `"clauditor"` field in `package.json` via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig).

## How it works

Claude Code writes session transcripts as JSONL to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Each line is a JSON record — user messages, assistant responses with token usage, tool calls, and results.

clauditor registers hooks via `clauditor install` into `~/.claude/settings.json`:

- **SessionStart** — injects health briefing when Claude Code launches
- **PostToolUse** — checks session health after every tool call, compresses bash output, detects edit thrashing
- **Stop** — blocks loops when the same tool calls repeat 3+ times

The hooks receive JSON on stdin and output decisions to stdout — Claude Code's official extension mechanism. clauditor also watches the JSONL files with chokidar for the real-time dashboard.

## Development

```bash
git clone https://github.com/IyadhKhalfallah/clauditor.git
cd clauditor
npm install
npm test
npm run build
npm link  # makes `clauditor` available globally
```

## Legal

This project is open source under the MIT license.

- **No leaked source code** was referenced or used in this project
- All features are derived from publicly documented behavior and independent observation
- "clauditor" is a portmanteau of "Claude" + "auditor" used in a descriptive, nominative sense
- Not affiliated with or endorsed by Anthropic

## Contributing

Contributions welcome! Please follow these rules:

- **No leaked source code.** Do not reference, port, or derive logic from any leaked or non-public Anthropic code.
- **Knowledge sources must be attributable** to official docs, public community discussions, or independent behavioral observation.
- **Clean-room implementation.** If unsure whether something came from non-public materials, do not contribute it. Describe the observed behavior instead.

## License

MIT
