# clauditor

> Session health monitoring for Claude Code — keep your sessions fast and your context intact.

clauditor watches your Claude Code sessions in real time. It detects when cache breaks (making responses slow), when Claude gets stuck in loops, when your context window is about to overflow, and when session resume drains your quota — then tells you exactly what to do about it.

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
# Register hooks into Claude Code
clauditor install

# Start the live dashboard
clauditor watch

# Quick health check (no TUI)
clauditor status

# Check for cache bugs in recent sessions
clauditor doctor

# View usage stats for the past week
clauditor stats

# See what clauditor has done for you
clauditor impact

# See recent actions (warnings injected, loops blocked, etc.)
clauditor activity

# Audit your CLAUDE.md token footprint
clauditor check-memory
```

## What it looks like

```
── clauditor ──

 RECENT SESSIONS (18)

    api-service (dev)               healthy    536 turns  just now
    ↳ subagent a5                   healthy     75 turns  36m ago
    ↳ subagent ac                   degraded   197 turns  2h ago

 api-service (dev)  opus-4-6  536 turns
 /Users/alice/projects/api-service

 CACHE HEALTH

  Turn 533: ████████████████████ 100% ✓
  Turn 534: ████████████████████ 100% ✓
  Turn 535: ████████████████████ 100% ✓
  Turn 536: ████████████████████  99% ✓

  Status: ✓ healthy

 TOKEN USAGE (this session)

  Input: 1,231   Output: 121,553
  Cache reads: 43,204,167   Cache writes: 20,378,532
  Est. cost: ~$456.04   Saved vs uncached: ~$506.84

 ALERTS

  ● Context window full — 206k tokens (103%)
    Claude Code will auto-compact soon, which may lose important context.
    → Start a fresh session now. Summarize key context in CLAUDE.md.
```

Sessions are labeled by **project name and git branch** — not cryptic IDs. Subagent sessions are grouped under their parent. Alerts tell you **what's wrong, why it matters, and exactly what to do**.

## Features

### Cache health detection

The highest-value feature. Detects a well-documented cache degradation pattern where `cache_read_input_tokens` stops growing while `cache_creation_input_tokens` keeps increasing — meaning your conversation history is reprocessed from scratch instead of reading from cache. This can inflate costs **10-20x** on long sessions.

When degradation is detected:
- Desktop notification via `node-notifier`
- Red alert in the TUI with the exact fix

```
● Cache degradation — reprocessing history each turn
  Cache hit ratio is 12% but should be >70%. Each turn is re-reading
  your full context as new tokens, inflating costs 10-20x.
  → In Claude Code, run /clear to reset context, then re-state what
    you're working on. Or start a new session with claude.
```

### Loop detection

Uses Claude Code's official Stop hook to detect and break compaction loops. When the same tool calls repeat 3+ times with identical input and output, clauditor blocks further execution.

```
● Loop detected — Bash call repeated 4x
  Claude is repeating the same action and getting the same result,
  burning tokens without progress.
  → Interrupt Claude (Ctrl+C or Esc), then describe the problem
    differently. Try breaking the task into smaller steps.
```

### Cost tracking

Real-time cost estimation with model-aware pricing. Automatically detects which model (Opus, Sonnet, Haiku) each session is using:

| Model | Input | Output | Cache create | Cache read |
|---|---|---|---|---|
| Opus 4.6 | $15/M | $75/M | $18.75/M | $1.50/M |
| Sonnet 4.6 | $3/M | $15/M | $3.75/M | $0.30/M |
| Haiku 4.5 | $0.80/M | $4/M | $1.00/M | $0.08/M |

Shows how much cache is saving you compared to uncached pricing.

### Context window monitoring

Alerts at 80% (yellow) and 100% (red) of the 200k context window with specific guidance:

- **80%**: "Consider wrapping up. If you need to continue, start a new session."
- **100%**: "Start a fresh session now. Summarize key context in CLAUDE.md so it persists."

### CLAUDE.md auditing

```bash
clauditor check-memory
```

Scans your full CLAUDE.md hierarchy:

1. `/etc/claude-code/CLAUDE.md` (system)
2. `~/.claude/CLAUDE.md` (user)
3. `./CLAUDE.md` (project)
4. `.claude/rules/*.md` (rules)
5. `./CLAUDE.local.md` (private)

Reports token count per file, cost per message (cached vs uncached), and flags entries > 150 chars that are likely storing data inline instead of using pointers.

### Bash output compression

A PostToolUse hook that summarizes verbose bash output to reduce token waste:

- Strips progress bars and unicode spinners
- Collapses repeated identical lines
- Summarizes npm/yarn/pnpm install output
- Keeps only error/warning/failure lines from build output
- Truncates to configurable max length (default 2000 chars)

### Resume safety

Detects two known bugs with `--resume` and `--continue` flags:

- **Token explosion** (GitHub #38029): 652K+ output tokens generated silently on session resume, draining entire quota in minutes
- **Cache invalidation** (GitHub #40524): resume injects tool attachments at wrong position, invalidating the entire prompt cache

### Impact tracking

```bash
clauditor impact
```

Shows lifetime stats — what clauditor has caught across all your sessions:

```
clauditor impact
──────────────────────────────────────
  Monitoring since: 4/2/2026  (7 days)
  Sessions monitored: 107

  Issues caught:
    ● 5 broken cache sessions detected
    ● 2 infinite loops caught
    ● 1 resume anomaly flagged
    ● 3 context overflow warnings
  Total issues caught: 11 across 107 sessions
```

### Activity log

```bash
clauditor activity
```

See every action clauditor has taken — warnings injected into Claude's context, loops blocked, bash output compressed:

```
  2m ago     ⚡ Injected cache warning — ratio at 12%
  15m ago    🛑 Blocked loop — Bash call(s) repeated 4x
  1h ago     🔔 Desktop notification: cache degradation on api-service (dev)
  3h ago     📦 Compressed bash output: 12.4k chars → 1.8k chars
```

Also visible in the TUI dashboard as a live feed.

### Usage statistics

```bash
clauditor stats --days 30
```

Historical breakdown showing:
- Total tokens per day (input, output, cache reads, cache writes)
- Cache efficiency ratio across sessions
- Top 5 most expensive sessions
- Tool call frequency breakdown (Bash vs Read vs Edit, etc.)
- Estimated total cost with savings from cache

## Commands

| Command | Description |
|---|---|
| `clauditor watch` | Live TUI dashboard for active sessions |
| `clauditor status` | Quick one-line health check (no TUI) |
| `clauditor impact` | Lifetime stats — what clauditor has caught |
| `clauditor activity` | Recent actions log |
| `clauditor install` | Register hooks in `~/.claude/settings.json` |
| `clauditor uninstall` | Remove hooks |
| `clauditor stats` | Historical usage analysis (7 days default) |
| `clauditor doctor` | Scan recent sessions for cache bugs |
| `clauditor check-memory` | Audit CLAUDE.md token footprint |

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

clauditor:

1. **Watches** these files with chokidar for real-time updates
2. **Parses** each record to extract token usage, tool calls, and session metadata
3. **Computes** cache ratios, cost estimates, loop detection, and context size
4. **Renders** the TUI dashboard from an in-memory session store
5. **Notifies** you via desktop alerts when things go wrong

Hooks are registered via `clauditor install` into `~/.claude/settings.json`. They receive JSON on stdin and output decisions to stdout — Claude Code's official extension mechanism.

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

See the contribution guidelines below for full compliance requirements.

## Contributing

Contributions welcome! Please follow these rules:

- **No leaked source code.** Do not reference, port, or derive logic from any leaked or non-public Anthropic code.
- **Knowledge sources must be attributable** to official docs, public community discussions, or independent behavioral observation.
- **Clean-room implementation.** If unsure whether something came from non-public materials, do not contribute it. Describe the observed behavior instead.

## License

MIT
