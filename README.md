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
║  clauditor: Session using 16x more quota than necessary     ║
╚══════════════════════════════════════════════════════════════╝

Your turns started at 25k tokens.
They're now at 398k tokens.
Each turn uses 16x more quota than when this session started.

Session state saved.
  Branch: feat/variable-agent
  Files: FileAgent.cs, ServiceCollectionExtensions.cs, +13 more
  Turns: 889

Start fresh: run `claude` — clauditor will inject your previous session context.
```

Claude sees this, stops, and tells you to start a fresh session. Your context is preserved. Zero tokens wasted.

## Install

```bash
npm install -g @iyadhk/clauditor
clauditor install
```

That's it. Two commands. clauditor registers hooks into Claude Code and runs in the background. No dashboard needed. No config needed.

Requires Node.js 20+.

**Supported platforms:** Claude Code CLI, VS Code extension, JetBrains extension. Does **not** work with Claude Code on the web (claude.ai/code).

## How it works

clauditor registers 5 hooks into Claude Code:

### `UserPromptSubmit` — blocks before tokens are wasted

Before Claude processes your prompt, clauditor checks the **waste factor**: how many more tokens per turn you're using compared to the start of your session.

```
Waste factor = current tokens/turn ÷ baseline tokens/turn

  1x = efficient (fresh session)
  5x = growing
 10x = blocked — start fresh
```

At 10x waste (configurable), clauditor blocks the prompt. You see the message. Claude sees it. No tokens are burned on the blocked turn.

### `PostToolUse` — blocks during autonomous work

When Claude is working autonomously (editing files, running commands), there's no user prompt to intercept. The PostToolUse hook catches this — after each tool call, it checks the waste factor and blocks if too high.

Uses exit code 2, which Claude Code treats as a blocking error. Claude acknowledges it and stops.

### `PreCompact` — saves context before compaction

Fires at the exact moment before Claude Code compacts your context. Saves session state (branch, files modified, turn count) to `~/.clauditor/last-session.md`. No guessing about context thresholds.

### `SessionStart` — injects previous session context

When you start a new session, clauditor reads the saved state from `~/.clauditor/last-session.md` and injects it into Claude's context. Claude picks up where you left off.

### `Stop` — blocks infinite loops

When Claude repeats the same tool call 3+ times with identical input and output, the Stop hook blocks it.

## Real data

From a real user's Claude Code usage over 7 days:

```
Session                                  Turns  Tokens/turn   Waste
─────────────────────────────────────────────────────────────────────
api-service (feat/variable-agent)          889     395k/turn    16x   ← clauditor blocked this
api-service (feat/variable-agent)            5      20k/turn     1x   ← fresh session after block
api-service (feat/agentic-file)            779     168k/turn    13x
api-service (fix/delete-test-cases)        321     116k/turn     9x
api-service (dev)                          300     137k/turn    10x
api-service (fix/file-assertion)           216      99k/turn     8x
```

Every session over 100 turns was burning 8-16x more quota than necessary. clauditor would have rotated each one, reducing total quota usage by an estimated 5-10x.

## Dashboard (optional)

```bash
clauditor watch
```

```
── clauditor ──  4 sessions + 24 subagents (last 12h)

 api-service (feat/variable-agent)  opus-4-6 · 33 turns

 Waste factor: 2x  efficient
 ███░░░░░░░░░░░░░░░░░░░░░░░░░░░
 Started at 20k/turn → now 41k/turn (2x more quota per turn)

 Cache: 99%  Turns: 33  ~$4 API est.

 OTHER SESSIONS
 ⟲ api-service (feat/variable-agent)    902 turns  400k/turn
 · api-service (feat/agentic-file)        2 turns   20k/turn
 ✓ api-service (feat/agentic-file)      209 turns  193k/turn

 LAST ACTIONS
 just now   📦 BLOCKED tool result — 16x waste
 8m ago     📦 BLOCKED prompt — 15x waste factor

 q to quit
```

The bar fills up as your session grows. At 10x, clauditor blocks.

## Session history

```bash
clauditor sessions
```

See where your tokens went:

```
Sessions from last 7 days (70 total):
────────────────────────────────────────────────────────────────────────
  api-service (feat/variable-agent)  opus-4-6    889 turns  cache: 100%  ~$645
    ⚠ 16x waste — blocked by clauditor
  api-service (feat/variable-agent)  opus-4-6      5 turns  cache: 99%     ~$1
  api-service (feat/agentic-file)    opus-4-6    779 turns  cache: 100%  ~$563
  api-service (fix/delete-test-cases) opus-4-6   321 turns  cache: 100%   ~$68
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

## Audit-only mode (no hooks)

Don't want clauditor to block or modify your sessions? Skip `clauditor install` and use it as a read-only analytics tool:

```bash
npm install -g @iyadhk/clauditor
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

When rotation triggers, clauditor extracts rich context from the session transcript and saves to `~/.clauditor/last-session.md`:

```markdown
# Last Session (saved by clauditor)

- **Branch:** feat/variable-agent
- **Project:** /Users/alice/projects/api-service
- **Session size:** 108 turns, 91k tokens/turn
- **Waste factor:** 5x
- **Files modified:** VariableAgentEvaluator.cs, DateTimeTools.cs, AIActionExecutor.cs
- **Files read:** Program.cs, appsettings.json, VariableAgent.cs

## Original Task
Add a new evaluation mode to the VariableAgentEvaluator that supports generate.csv format

## Commits Made
- feat: add generation dataset support to VariableAgentEvaluator
- fix: handle regex matching for multi-format expected outputs

## Key Commands & Results
- dotnet test --filter VariableAgent
- → Passed! - Failed: 0, Passed: 91

## Where We Left Off
Next steps:
1. Building the model-agnostic tool-use loop in MultiLLMClient
2. Migrating VariableAgentRunner to use it
```

On the next `SessionStart`, this is injected into Claude's context. Claude reads it and picks up where you left off — including the plan from the previous session. No CLAUDE.md modification, no git noise, no extra tokens per turn.

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

**Hook communication:**

| Hook | Mechanism | Why |
|---|---|---|
| `UserPromptSubmit` | `decision: "block"` | Stops prompt before processing |
| `PostToolUse` | Exit code 2 + stderr | Blocking error — Claude acknowledges and stops |
| `PreCompact` | File write | Saves state at exact compaction moment |
| `SessionStart` | `additionalContext` | Injects previous session state |
| `Stop` | `decision: "block"` | Prevents infinite loops |

## Limitations

- **Cannot reduce Claude Code's context assembly.** We observe and advise — we don't modify what Claude Code sends to the API.
- **Cannot see quota.** Anthropic doesn't expose quota data. The waste factor is a proxy based on token growth.
- **Cache reads may or may not count toward quota.** The exact quota accounting for Max plan subscribers is not published.
- **Web sessions not supported.** Only CLI and IDE extensions write local JSONL files.
- **Per-device only.** Sessions don't sync across machines.

## Development

```bash
git clone https://github.com/IyadhKhalfallah/clauditor.git
cd clauditor
npm install
npm test        # 68 tests
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
