import { Command } from 'commander'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { cosmiconfig } from 'cosmiconfig'
import { DEFAULT_CONFIG } from './types.js'
import type { ClauditorConfig } from './types.js'

// Read version from package.json so it stays in sync with releases
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('clauditor')
  .description('Real-time session health monitoring for Claude Code')
  .version(pkg.version)

// ─── clauditor watch ──────────────────────────────────────────────

program
  .command('watch')
  .description('Live TUI dashboard for active sessions')
  .option('-p, --project <path>', 'Watch a specific project directory')
  .option('-a, --all', 'Watch all projects')
  .action(async (options) => {
    const config = await loadConfig()
    const { startDaemon } = await import('./daemon/index.js')
    const { render } = await import('ink')
    const React = await import('react')
    const { App } = await import('./tui/app.js')

    const projectPath = options.project ? resolve(options.project) : undefined

    // Clear terminal before rendering to prevent stacked frames
    process.stdout.write('\x1B[2J\x1B[H')

    const { store } = await startDaemon({
      projectsDir: config.watch.projectsDir,
      projectPath,
      pollInterval: config.watch.pollInterval,
      alerts: config.alerts,
    })

    const encodedProject = projectPath
      ? projectPath.replace(/[^a-zA-Z0-9]/g, '-')
      : undefined

    const { waitUntilExit } = render(
      React.createElement(App, { store, projectPath: encodedProject })
    )

    await waitUntilExit()
  })

// ─── clauditor status ─────────────────────────────────────────────

program
  .command('status')
  .description('Quick health check of your most recent session (no TUI)')
  .option('-p, --project <path>', 'Check a specific project')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const { estimateCost, getPricingForModel } = await import('./features/cost-tracker.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
      projectPath: options.project ? resolve(options.project) : undefined,
    })
    await watcher.scanAll()

    const sessions = store.getAll()
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())

    if (sessions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'no_sessions' }))
      } else {
        console.log('No active sessions found.')
      }
      return
    }

    const s = sessions[0]
    const lastTurn = s.turns[s.turns.length - 1]
    const contextSize = lastTurn
      ? lastTurn.usage.input_tokens +
        lastTurn.usage.cache_creation_input_tokens +
        lastTurn.usage.cache_read_input_tokens
      : 0
    const isOpus = s.model?.includes('opus') ?? false
    const contextLimit = isOpus ? 1_000_000 : 200_000
    const contextPct = Math.round((contextSize / contextLimit) * 100)
    const pricing = s.model ? getPricingForModel(s.model) : undefined
    const cost = estimateCost(s.totalUsage, pricing)

    if (options.json) {
      console.log(JSON.stringify({
        session: s.label,
        model: s.model,
        turns: s.turns.length,
        cacheStatus: s.cacheHealth.status,
        cacheRatio: s.cacheHealth.lastCacheRatio,
        contextPercent: contextPct,
        contextTokens: contextSize,
        loopDetected: s.loopState.loopDetected,
        cost: cost.totalCost,
        savedByCache: cost.savedVsUncached,
      }, null, 2))
      return
    }

    const cacheColor = s.cacheHealth.lastCacheRatio >= 0.7 ? '\x1b[32m'
      : s.cacheHealth.lastCacheRatio >= 0.4 ? '\x1b[33m' : '\x1b[31m'
    const ctxColor = contextPct >= 90 ? '\x1b[31m'
      : contextPct >= 70 ? '\x1b[33m' : '\x1b[32m'
    const reset = '\x1b[0m'

    console.log(`\n  ${s.label}`)
    console.log(`  ${s.model?.replace('claude-', '').split('-2')[0] || 'unknown'} · ${s.turns.length} turns\n`)
    console.log(`  Cache:    ${cacheColor}${(s.cacheHealth.lastCacheRatio * 100).toFixed(0)}% ${s.cacheHealth.status}${reset}`)
    console.log(`  Context:  ${ctxColor}${contextPct}%${reset} (${(contextSize / 1000).toFixed(0)}k / ${(contextLimit / 1000).toFixed(0)}k)`)

    if (s.loopState.loopDetected) {
      console.log(`  Loop:     \x1b[31m${s.loopState.loopPattern} (${s.loopState.consecutiveIdenticalTurns}x)\x1b[0m`)
    }

    console.log(`  Cost:     ~$${cost.totalCost.toFixed(2)} (saved ~$${cost.savedVsUncached.toFixed(2)} by cache)`)

    // Show issues
    if (s.cacheHealth.degradationDetected) {
      console.log(`\n  \x1b[31m● Session is slow — cache is broken\x1b[0m`)
      console.log(`    → Run /clear in Claude Code, then re-state what you're working on.`)
    }
    if (contextPct >= 95) {
      console.log(`\n  \x1b[31m● Context full — Claude is about to forget things\x1b[0m`)
      console.log(`    → Start a fresh session. Save important context to CLAUDE.md first.`)
    } else if (contextPct >= 80) {
      console.log(`\n  \x1b[33m● Context filling up — ${contextPct}% used\x1b[0m`)
      console.log(`    → Good time to wrap up and start a new session.`)
    }

    if (!s.cacheHealth.degradationDetected && contextPct < 80 && !s.loopState.loopDetected) {
      console.log(`\n  \x1b[32m✓ All clear — session is healthy.\x1b[0m`)
    }

    console.log('')
  })

// ─── clauditor install ────────────────────────────────────────────

program
  .command('install')
  .description('Register clauditor hooks in ~/.claude/settings.json')
  .option('--claude-dir <path>', 'Path to Claude config directory (default: ~/.claude)')
  .action(async (opts: { claudeDir?: string }) => {
    const { installHooks } = await import('./install.js')
    const messages = await installHooks(opts.claudeDir)
    for (const msg of messages) {
      console.log(msg)
    }
  })

// ─── clauditor uninstall ──────────────────────────────────────────

program
  .command('uninstall')
  .description('Remove clauditor hooks from ~/.claude/settings.json')
  .option('--claude-dir <path>', 'Path to Claude config directory (default: ~/.claude)')
  .action(async (opts: { claudeDir?: string }) => {
    const { uninstallHooks } = await import('./install.js')
    const messages = await uninstallHooks(opts.claudeDir)
    for (const msg of messages) {
      console.log(msg)
    }
  })

// ─── clauditor login ─────────────────────────────────────────────

const DEFAULT_HUB_URL = 'https://www.clauditor.ai'

program
  .command('login')
  .description('Sign in to clauditor hub')
  .option('--hub-url <url>', 'Hub URL', DEFAULT_HUB_URL)
  .option('--device', 'Use device code flow instead of opening browser')
  .action(async (options) => {
    const { createHash } = await import('node:crypto')
    const { hostname, userInfo } = await import('node:os')
    const { setProjectHubConfig } = await import('./config.js')
    const { getGitRemoteUrl, getProjectHash } = await import('./hub/git-project.js')

    const remoteUrl = getGitRemoteUrl()
    if (!remoteUrl) {
      console.error('\n  ✗ Not a git repo with a remote origin.')
      console.error('    Run this from inside a git repo with a remote configured.')
      process.exit(1)
    }

    const developerHash = createHash('sha256')
      .update(`${hostname()}:${userInfo().username}`)
      .digest('hex')
      .slice(0, 16)

    const hubUrl = options.hubUrl
    const isSSH = !!(process.env.SSH_CONNECTION || process.env.SSH_TTY || process.env.SSH_CLIENT)
    const useDeviceFlow = options.device || isSSH

    // Auto-install hooks if not already installed
    try {
      const { existsSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const { homedir } = await import('node:os')
      const settingsPath = resolve(homedir(), '.claude', 'settings.json')
      if (existsSync(settingsPath)) {
        const settings = JSON.parse((await import('node:fs')).readFileSync(settingsPath, 'utf-8'))
        const hasHooks = settings.hooks && Object.keys(settings.hooks).length > 0
        if (!hasHooks) {
          console.log('\n  Setting up clauditor hooks...')
          const { installHooks } = await import('./install.js')
          const msgs = await installHooks()
          msgs.forEach((m: string) => console.log(m))
        }
      } else {
        console.log('\n  Setting up clauditor hooks...')
        const { installHooks } = await import('./install.js')
        const msgs = await installHooks()
        msgs.forEach((m: string) => console.log(m))
      }
    } catch {
      // Non-critical — hooks can be installed manually with `clauditor install`
    }

    if (useDeviceFlow) {
      // Device flow (RFC 8628) — for SSH, headless, or --no-browser
      await loginDeviceFlow(hubUrl, remoteUrl, developerHash)
    } else {
      // Browser flow — primary, opens localhost callback
      await loginBrowserFlow(hubUrl, remoteUrl, developerHash)
    }
  })

async function loginBrowserFlow(hubUrl: string, remoteUrl: string, developerHash: string) {
  const { createHash } = await import('node:crypto')
  const { startAuthServer } = await import('./hub/auth-server.js')
  const { setProjectHubConfig } = await import('./config.js')
  const { getProjectHash } = await import('./hub/git-project.js')

  const state = createHash('sha256')
    .update(`${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 32)

  const { port, waitForResult } = await startAuthServer(state)
  const authUrl = `${hubUrl}/cli-auth?state=${state}&port=${port}&project=${encodeURIComponent(remoteUrl)}&developer_hash=${developerHash}`

  console.log('\n  Opening browser to sign in...')
  console.log(`\n  If the browser didn't open, visit:`)
  console.log(`  ${authUrl}\n`)

  try {
    const open = (await import('open')).default
    await open(authUrl)
  } catch {
    // Browser open failed — user will use the printed URL
  }

  console.log('  Waiting for authentication...')

  try {
    const result = await waitForResult()

    setProjectHubConfig(remoteUrl, {
      apiKey: result.apiKey,
      url: hubUrl,
      developerHash,
      teamName: result.teamName,
    })

    console.log(`\n  ✓ Logged in to team "${result.teamName}" (${result.plan})`)
    console.log(`  Connected: ${remoteUrl} → ${result.teamName}`)

    // Sync local auto-memory + show team brief summary
    const projectHash = getProjectHash()

    if (projectHash) {
      // Sync local auto-memory to hub (silent)
      try {
        const { readAutoMemory, syncMemoryToHub } = await import('./hub/memory-sync.js')
        const memories = readAutoMemory(process.cwd())
        if (memories.length > 0) {
          const syncResult = await syncMemoryToHub(memories, projectHash, developerHash, { apiKey: result.apiKey, url: hubUrl }, remoteUrl)
          if (syncResult.synced > 0) {
            console.log(`  ↑ Synced ${syncResult.synced} local memories to team hub`)
          }
        }
      } catch {}

      // Show brief count (not full entries — could be many)
      try {
        const briefRes = await fetch(`${hubUrl}/api/v1/knowledge/brief?project_hash=${projectHash}&max=1`, {
          headers: { 'X-Clauditor-Key': result.apiKey },
          signal: AbortSignal.timeout(5000),
        })
        if (briefRes.ok) {
          const briefData = await briefRes.json() as { brief: Array<{ title: string }>; sources?: Record<string, number> }
          const total = Object.values(briefData.sources || {}).reduce((a, b) => a + b, 0)
          if (total > 0) {
            console.log(`  ↓ ${total} team knowledge entries available — will be injected into your sessions`)
          } else {
            console.log(`  No team knowledge yet — it will accumulate as you work`)
          }
        }
      } catch {}
    }

    console.log('')

    // Check if MCP is already configured
    const mcpBase = 'https://mcp.clauditor.ai'
    const mcpUrl = `${mcpBase}/mcp?key=${result.apiKey}`

    let mcpAlreadyConfigured = false
    try {
      const { readFileSync } = await import('node:fs')
      const { resolve: resolvePath } = await import('node:path')
      const { homedir } = await import('node:os')
      const claudeJson = JSON.parse(readFileSync(resolvePath(homedir(), '.claude.json'), 'utf-8'))
      mcpAlreadyConfigured = !!claudeJson?.mcpServers?.clauditor
    } catch {}

    if (mcpAlreadyConfigured) {
      console.log(`  ✓ MCP already configured`)
    } else {
      // Verify MCP server is reachable
      let mcpAvailable = false
      try {
        const verifyRes = await fetch(`${mcpBase}/health`, { signal: AbortSignal.timeout(5000) })
        if (verifyRes.ok) {
          mcpAvailable = true
        }
      } catch {}

      if (mcpAvailable) {
        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        const answer = await new Promise<string>((resolve) => {
          rl.question('  Set up MCP so Claude can query team knowledge mid-session? (Y/n) ', (ans) => {
            rl.close()
            resolve(ans.trim().toLowerCase())
          })
        })

        if (answer !== 'n' && answer !== 'no') {
          try {
            const { execSync } = await import('node:child_process')
            try { execSync('claude mcp remove clauditor 2>/dev/null', { stdio: 'ignore' }) } catch {}
            execSync(`claude mcp add --transport http -s user clauditor "${mcpUrl}"`, { stdio: 'inherit' })
            console.log(`  ✓ MCP configured — start a new Claude Code session to use it`)
          } catch {
            try {
              const { readFileSync, writeFileSync } = await import('node:fs')
              const { resolve: resolvePath } = await import('node:path')
              const { homedir } = await import('node:os')
              const settingsPath = resolvePath(homedir(), '.claude', 'settings.json')

              let settings: Record<string, unknown> = {}
              try { settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) } catch {}

              const mcpServers = (settings.mcpServers || {}) as Record<string, unknown>
              mcpServers.clauditor = { type: 'http', url: mcpUrl }
              settings.mcpServers = mcpServers
              writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
              console.log(`  ✓ MCP configured via settings.json — start a new Claude Code session to use it`)
            } catch {
              console.log(`\n  To set up MCP manually, run:`)
              console.log(`  claude mcp add --transport http -s user clauditor "${mcpUrl}"`)
            }
          }
        } else {
          console.log(`\n  You can set up MCP later with:`)
          console.log(`  claude mcp add --transport http -s user clauditor "${mcpUrl}"`)
        }
      }
    }
  } catch (err) {
    console.error(`\n  ✗ ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

async function loginDeviceFlow(hubUrl: string, remoteUrl: string, developerHash: string) {
  const { requestDeviceCode, pollForToken } = await import('./hub/device-flow.js')
  const { setProjectHubConfig } = await import('./config.js')
  const { getProjectHash } = await import('./hub/git-project.js')

  console.log('\n  Requesting device code...')

  try {
    const projectHash = getProjectHash() || undefined
    const codes = await requestDeviceCode(hubUrl, projectHash, developerHash)

    console.log(`\n  Visit: ${codes.verification_url}`)
    console.log(`  Enter code: ${codes.user_code}`)
    console.log(`\n  Waiting for confirmation...`)

    const result = await pollForToken(hubUrl, codes.device_code, codes.interval, codes.expires_in)

    setProjectHubConfig(remoteUrl, {
      apiKey: result.api_key,
      url: hubUrl,
      developerHash,
      teamName: result.team_name,
    })

    console.log(`\n  ✓ Logged in to team "${result.team_name}" (${result.plan})`)
    console.log(`  Connected: ${remoteUrl} → ${result.team_name}`)
    console.log(`\n  Knowledge will sync automatically during sessions on this project.`)
  } catch (err) {
    console.error(`\n  ✗ ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

// ─── clauditor sync ──────────────────────────────────────────────

program
  .command('sync')
  .description('Sync local knowledge to the hub (auto-memory, session handoffs, pending queue)')
  .action(async () => {
    const { resolveHubContext } = await import('./hub/client.js')
    const hub = resolveHubContext()
    if (!hub) {
      console.error('\n  ✗ Not connected to a hub. Run `clauditor login` first.')
      process.exit(1)
    }

    console.log(`\n  Syncing to ${hub.config.teamName || 'hub'}...`)

    let totalPushed = 0

    // 1. Sync auto-memory
    try {
      const { readAutoMemory, syncMemoryToHub } = await import('./hub/memory-sync.js')
      const memories = readAutoMemory(process.cwd())
      if (memories.length > 0) {
        const result = await syncMemoryToHub(memories, hub.projectHash, hub.config.developerHash, hub.config, hub.remoteUrl)
        if (result.synced > 0) {
          console.log(`  ↑ ${result.synced} auto-memories synced`)
          totalPushed += result.synced
        } else {
          console.log(`  · Auto-memories already up to date`)
        }
      } else {
        console.log(`  · No local auto-memories found`)
      }
    } catch (err) {
      console.error(`  ✗ Auto-memory sync failed: ${err instanceof Error ? err.message : err}`)
    }

    // 2. Push session handoffs — structured learnings + summaries as team memories
    try {
      const { readRecentHandoffs, parseStructuredHandoff } = await import('./features/session-state.js')
      const { scrubSecrets } = await import('./features/secret-scrubber.js')
      const { queueAndSend } = await import('./hub/push-queue.js')
      const { createHash } = await import('node:crypto')
      const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      // Track which handoffs have been synced (by content hash)
      const syncedFile = resolve(homedir(), '.clauditor', 'synced-handoffs.json')
      let syncedHashes: string[] = []
      try { syncedHashes = JSON.parse(readFileSync(syncedFile, 'utf-8')) } catch {}

      const handoffs = readRecentHandoffs(process.cwd())
      let handoffLearnings = 0
      let summariesPushed = 0
      const newHashes: string[] = []

      for (const handoff of handoffs) {
        const scrubbed = scrubSecrets(handoff.content).scrubbed
        const contentHash = createHash('sha256').update(scrubbed).digest('hex').slice(0, 16)

        // Skip if already synced
        if (syncedHashes.includes(contentHash)) continue

        // Push structured learnings if present
        const parsed = parseStructuredHandoff(handoff.content)
        if (parsed.isStructured) {
          const learnings: Array<{ type: string; content: string }> = []
          for (const item of parsed.failedApproaches) {
            learnings.push({ type: 'failed_approach', content: scrubSecrets(item).scrubbed })
          }
          for (const item of parsed.dependencies) {
            learnings.push({ type: 'dependency', content: scrubSecrets(item).scrubbed })
          }
          for (const item of parsed.decisions) {
            learnings.push({ type: 'decision', content: scrubSecrets(item).scrubbed })
          }
          for (const item of parsed.whatSurprisedMe) {
            learnings.push({ type: 'surprise', content: scrubSecrets(item).scrubbed })
          }
          for (const item of parsed.gotchas) {
            learnings.push({ type: 'gotcha', content: scrubSecrets(item).scrubbed })
          }

          if (learnings.length > 0) {
            await queueAndSend(
              `${hub.config.url}/api/v1/handoff/learn`,
              { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
              {
                project_hash: hub.projectHash,
                developer_hash: hub.config.developerHash,
                project_name: hub.remoteUrl,
                learnings,
              }
            )
            handoffLearnings += learnings.length
          }
        }

        // Push full summary as team memory (direct fetch so we can report errors)
        if (scrubbed.length >= 100) {
          const filename = handoff.path.split('/').pop()?.replace('.md', '') || 'unknown'
          const memPayload = {
            project_hash: hub.projectHash,
            developer_hash: hub.config.developerHash,
            project_name: hub.remoteUrl,
            memories: [{
              name: `Session summary (${filename})`,
              description: 'Session summary captured at compaction',
              memory_type: 'session_summary',
              content: scrubbed,
              content_hash: contentHash,
              source_file: `session_${contentHash}`,
              scope: 'team',
            }],
          }
          try {
            const res = await fetch(`${hub.config.url}/api/v1/memory/sync`, {
              method: 'POST',
              headers: { 'X-Clauditor-Key': hub.config.apiKey, 'Content-Type': 'application/json' },
              body: JSON.stringify(memPayload),
              signal: AbortSignal.timeout(15000),
            })
            const data = await res.json() as { synced?: number; skipped?: number; error?: string }
            if (res.ok && data.synced && data.synced > 0) {
              summariesPushed++
            } else {
              console.error(`  ✗ Summary push failed: ${data.error || `synced=${data.synced} skipped=${data.skipped}`}`)
            }
          } catch (err) {
            console.error(`  ✗ Summary push error: ${err instanceof Error ? err.message : err}`)
          }
        }

        newHashes.push(contentHash)
      }

      // Persist synced hashes
      if (newHashes.length > 0) {
        const allHashes = [...new Set([...syncedHashes, ...newHashes])].slice(-200) // keep last 200
        mkdirSync(resolve(homedir(), '.clauditor'), { recursive: true })
        writeFileSync(syncedFile, JSON.stringify(allHashes))
      }

      if (handoffLearnings > 0) {
        console.log(`  ↑ ${handoffLearnings} structured learnings from handoffs`)
        totalPushed += handoffLearnings
      }
      if (summariesPushed > 0) {
        console.log(`  ↑ ${summariesPushed} session summary/summaries synced as team memories`)
        totalPushed += summariesPushed
      }
      if (handoffLearnings === 0 && summariesPushed === 0 && handoffs.length === 0) {
        console.log(`  · No recent session handoffs found`)
      }
    } catch (err) {
      console.error(`  ✗ Handoff sync failed: ${err instanceof Error ? err.message : err}`)
    }

    // 3. Flush push queue (retries for anything that failed earlier)
    try {
      const { flushQueue } = await import('./hub/push-queue.js')
      const { sent } = await flushQueue()
      if (sent > 0) {
        console.log(`  ↑ ${sent} queued item(s) flushed`)
        totalPushed += sent
      }
    } catch {}

    if (totalPushed > 0) {
      console.log(`\n  ✓ Synced ${totalPushed} item(s) to hub`)
    } else {
      console.log(`\n  ✓ Everything up to date`)
    }
  })

// ─── clauditor stats ─────────────────────────────────────────────

program
  .command('stats')
  .description('Historical usage analysis')
  .option('-d, --days <n>', 'Number of days to analyze', '7')
  .option('-p, --project <path>', 'Analyze a specific project')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const { estimateCost, getPricingForModel } = await import('./features/cost-tracker.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
      projectPath: options.project ? resolve(options.project) : undefined,
    })

    if (!options.json) console.log('Scanning session files...')
    await watcher.scanAll()

    const sessions = store.getAll()
    if (sessions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ sessions: 0 }))
      } else {
        console.log('No session data found.')
      }
      return
    }

    const daysAgo = parseInt(options.days) || 7
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysAgo)

    const recentSessions = sessions.filter(
      (s) => s.lastUpdated >= cutoff
    )

    const totalUsage = recentSessions.reduce(
      (acc, s) => ({
        input_tokens: acc.input_tokens + s.totalUsage.input_tokens,
        output_tokens: acc.output_tokens + s.totalUsage.output_tokens,
        cache_creation_input_tokens:
          acc.cache_creation_input_tokens + s.totalUsage.cache_creation_input_tokens,
        cache_read_input_tokens:
          acc.cache_read_input_tokens + s.totalUsage.cache_read_input_tokens,
      }),
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
    )

    const totalTokens =
      totalUsage.input_tokens +
      totalUsage.output_tokens +
      totalUsage.cache_creation_input_tokens +
      totalUsage.cache_read_input_tokens

    const cost = estimateCost(totalUsage)

    const cacheRatio =
      totalUsage.cache_read_input_tokens /
      (totalUsage.cache_read_input_tokens +
        totalUsage.cache_creation_input_tokens +
        totalUsage.input_tokens || 1)

    // Tool call breakdown
    const toolCounts = new Map<string, number>()
    for (const session of recentSessions) {
      for (const turn of session.turns) {
        for (const call of turn.toolCalls) {
          toolCounts.set(call.name, (toolCounts.get(call.name) || 0) + 1)
        }
      }
    }

    // Most expensive sessions
    const topSessions = recentSessions
      .map((s) => {
        const pricing = s.model ? getPricingForModel(s.model) : undefined
        return {
          label: s.label,
          model: s.model?.replace('claude-', '').split('-2')[0] || '',
          cost: estimateCost(s.totalUsage, pricing).totalCost,
          turns: s.turns.length,
          cacheStatus: s.cacheHealth.status,
        }
      })
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5)

    if (options.json) {
      console.log(JSON.stringify({
        days: daysAgo,
        sessions: recentSessions.length,
        totalTokens,
        usage: totalUsage,
        cost: cost.totalCost,
        savedByCache: cost.savedVsUncached,
        cacheEfficiency: cacheRatio,
        toolCalls: Object.fromEntries(toolCounts),
        topSessions,
      }, null, 2))
      return
    }

    console.log(`\nStats for last ${daysAgo} days:`)
    console.log('─'.repeat(50))
    console.log(`  Sessions:      ${recentSessions.length}`)
    console.log(`  Total tokens:  ${totalTokens.toLocaleString()}`)
    console.log(`  Input:         ${totalUsage.input_tokens.toLocaleString()}`)
    console.log(`  Output:        ${totalUsage.output_tokens.toLocaleString()}`)
    console.log(`  Cache reads:   ${totalUsage.cache_read_input_tokens.toLocaleString()}`)
    console.log(`  Cache writes:  ${totalUsage.cache_creation_input_tokens.toLocaleString()}`)

    console.log(`\n  Est. cost:     ~$${cost.totalCost.toFixed(2)}`)
    console.log(`  Saved by cache: ~$${cost.savedVsUncached.toFixed(2)}`)
    console.log(`  Cache efficiency: ${(cacheRatio * 100).toFixed(1)}%`)

    if (toolCounts.size > 0) {
      console.log('\n  Tool calls:')
      const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
      for (const [name, count] of sorted.slice(0, 10)) {
        console.log(`    ${name.padEnd(20)} ${count}`)
      }
    }

    console.log('\n  Most expensive sessions:')
    for (const s of topSessions) {
      console.log(
        `    ${s.label.slice(0, 25).padEnd(25)}  ~$${s.cost.toFixed(2).padStart(8)}  ${String(s.turns).padStart(4)} turns  ${s.model.padEnd(10)}  cache: ${s.cacheStatus}`
      )
    }
  })

// ─── clauditor check-memory ──────────────────────────────────────

program
  .command('check-memory')
  .description('Audit CLAUDE.md token footprint')
  .option('-p, --project <path>', 'Project to audit', '.')
  .action(async (options) => {
    const config = await loadConfig()
    const { auditMemoryFiles, formatAuditResult } = await import(
      './features/memory-guard.js'
    )

    const projectPath = resolve(options.project)
    const result = await auditMemoryFiles(
      projectPath,
      config.alerts.claudeMdTokenWarning
    )
    console.log(formatAuditResult(result, projectPath))
  })

// ─── clauditor doctor ────────────────────────────────────────────

program
  .command('doctor')
  .description('Check for cache degradation in recent sessions')
  .option('-p, --project <path>', 'Check a specific project')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const { estimateCost, getPricingForModel } = await import('./features/cost-tracker.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
      projectPath: options.project ? resolve(options.project) : undefined,
    })

    if (!options.json) console.log('Scanning session files...')
    await watcher.scanAll()

    const sessions = store.getAll()
    if (sessions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ sessions: 0, issues: [] }))
      } else {
        console.log('No session data found.')
      }
      return
    }

    const issues: Array<{
      label: string
      severity: 'broken' | 'degraded'
      turns: number
      cacheRatio: number
      trend: number[]
    }> = []

    for (const session of sessions) {
      if (session.cacheHealth.degradationDetected) {
        issues.push({
          label: session.label,
          severity: 'broken',
          turns: session.turns.length,
          cacheRatio: session.cacheHealth.lastCacheRatio,
          trend: session.cacheHealth.cacheRatioTrend,
        })
      } else if (session.cacheHealth.status === 'degraded') {
        issues.push({
          label: session.label,
          severity: 'degraded',
          turns: session.turns.length,
          cacheRatio: session.cacheHealth.lastCacheRatio,
          trend: session.cacheHealth.cacheRatioTrend,
        })
      }
    }

    if (options.json) {
      console.log(JSON.stringify({ sessions: sessions.length, issues }, null, 2))
      return
    }

    if (issues.length === 0) {
      console.log(`\n✓ No cache issues detected across ${sessions.length} sessions.`)
      return
    }

    console.log(`\nFound ${issues.length} session(s) with cache issues:\n`)

    for (const issue of issues) {
      const icon = issue.severity === 'broken' ? '✗' : '⚠'
      const severityLabel = issue.severity === 'broken'
        ? 'CACHE BROKEN — responses are slow'
        : 'Cache degraded — efficiency is low'

      console.log(`  ${icon} ${issue.label}`)
      console.log(`    ${severityLabel}`)
      console.log(`    ${issue.turns} turns · cache ratio: ${(issue.cacheRatio * 100).toFixed(0)}%`)
      console.log(`    Trend: ${issue.trend.map((r) => `${(r * 100).toFixed(0)}%`).join(' → ')}`)

      if (issue.severity === 'broken') {
        console.log(`    → Run /clear in that session, or start a fresh one.`)
      }
      console.log('')
    }
  })

// ─── clauditor impact ────────────────────────────────────────────

program
  .command('impact')
  .description('Show lifetime stats — what clauditor has caught for you')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const {
      loadImpactStats,
      saveImpactStats,
      updateImpactFromSessions,
      formatImpactStats,
    } = await import('./features/impact-tracker.js')

    // Scan current sessions and update impact stats
    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
    })

    if (!options.json) console.log('Scanning session files...')
    await watcher.scanAll()

    const sessions = store.getAll()
    let stats = await loadImpactStats()
    stats = updateImpactFromSessions(stats, sessions)
    await saveImpactStats(stats)

    if (options.json) {
      const { countedSessions, ...publicStats } = stats
      console.log(JSON.stringify(publicStats, null, 2))
      return
    }

    console.log('\n' + await formatImpactStats(stats))
    console.log('')
  })

// ─── clauditor activity ──────────────────────────────────────────

program
  .command('activity')
  .description('Show recent clauditor actions — warnings injected, loops blocked, etc.')
  .option('-n, --limit <n>', 'Number of events to show', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { readActivity, formatActivity } = await import('./features/activity-log.js')
    const limit = parseInt(options.limit) || 20
    const events = await readActivity(limit)

    if (options.json) {
      console.log(JSON.stringify(events, null, 2))
      return
    }

    console.log('\nclauditor activity')
    console.log('─'.repeat(50))
    console.log(formatActivity(events))
    console.log('')
  })

// ─── clauditor calibrate ──────────────────────────────────────────

program
  .command('calibrate')
  .description('Auto-calibrate rotation threshold from your session history')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { calibrate, formatCalibration } = await import('./features/calibration.js')

    if (!options.json) console.log('Scanning session history...')
    const result = calibrate()

    if (options.json) {
      const { sessionProfiles, ...summary } = result
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    console.log('\n' + formatCalibration(result))

    if (result.confident) {
      console.log(`\n  ✓ Calibrated: will block at ${result.wasteThreshold}x waste, ${result.minTurns}+ turns`)
    } else {
      console.log(`\n  ⚠ Not enough data — using conservative 10x threshold`)
      console.log(`    Use Claude Code for a few more sessions, then run \`clauditor calibrate\` again`)
    }
    console.log('')
  })

// ─── clauditor report ────────────────────────────────────────────

program
  .command('report')
  .description('Show quota usage report — see where your tokens went')
  .option('-d, --days <n>', 'Number of days to look back', '7')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { computeQuotaBrief } = await import('./features/quota-report.js')
    const days = parseInt(options.days, 10) || 7
    const brief = computeQuotaBrief(days)

    if (options.json) {
      console.log(JSON.stringify(brief, null, 2))
      return
    }

    if (brief.totalSessions === 0) {
      console.log('No sessions found in the last ' + days + ' days.')
      return
    }

    console.log('')
    console.log(`  Quota Report — last ${days} days`)
    console.log('  ' + '─'.repeat(58))
    console.log('')
    console.log('  TURNS  BASE   NOW   WASTE  TOKENS')
    console.log('  ' + '─'.repeat(58))

    for (const s of brief.sessions) {
      const barLen = Math.min(25, Math.round(s.wasteFactor))
      const bar = '█'.repeat(barLen)
      const color = s.wasteFactor >= 5 ? '\x1b[31m' : s.wasteFactor >= 3 ? '\x1b[33m' : '\x1b[32m'
      const reset = '\x1b[0m'

      console.log(
        `  ${String(s.turns).padStart(5)}  ` +
        `${(s.baselineK + 'k').padStart(4)}  ` +
        `${(s.currentK + 'k').padStart(4)}  ` +
        `${color}${(s.wasteFactor + 'x').padStart(5)}${reset}  ` +
        `${(Math.round(s.totalTokens / 1e6) + 'M').padStart(5)}  ` +
        `${color}${bar}${reset}`
      )
    }

    console.log('  ' + '─'.repeat(58))
    console.log('')
    console.log(`  ${brief.totalSessions} sessions · ${(brief.totalTokens / 1e6).toFixed(0)}M tokens total`)
    if (brief.sessionsOver5x > 0) {
      console.log(`  \x1b[31m${brief.sessionsOver5x} sessions burned 5x+ more quota than necessary\x1b[0m`)
    }
    if (brief.sessionsOver3x > 0 && brief.sessionsOver3x > brief.sessionsOver5x) {
      console.log(`  \x1b[33m${brief.sessionsOver3x - brief.sessionsOver5x} more sessions used 3-5x quota\x1b[0m`)
    }

    if (brief.worstSession && brief.worstSession.wasteFactor >= 3) {
      const w = brief.worstSession
      console.log('')
      console.log(`  Worst: ${w.label} (${w.turns} turns)`)
      console.log(`  Started at ${w.baselineK}k/turn, ended at ${w.currentK}k/turn (${w.wasteFactor}x waste)`)
      console.log(`  With rotation, this session would have used ~${Math.round(w.turns * w.baselineK * 2 / 1000)}M tokens instead of ${Math.round(w.totalTokens / 1e6)}M`)
    }

    // Clauditor impact
    const saved = brief.totalTokens - brief.tokensWithRotation
    if (saved > 0) {
      const pctSaved = Math.round(saved / brief.totalTokens * 100)
      console.log('')
      console.log('  ' + '─'.repeat(58))
      console.log(`  \x1b[36mclauditor impact\x1b[0m`)
      if (brief.sessionsBlocked > 0) {
        console.log(`  Blocked ${brief.sessionsBlocked} session${brief.sessionsBlocked > 1 ? 's' : ''} from burning more quota`)
      }
      console.log(`  With rotation on all sessions: ${Math.round(brief.tokensWithRotation / 1e6)}M tokens instead of ${Math.round(brief.totalTokens / 1e6)}M`)
      console.log(`  \x1b[32mPotential savings: ${Math.round(saved / 1e6)}M tokens (${pctSaved}% less quota)\x1b[0m`)
    }

    if (brief.sessionsOnBuggyVersion > 0) {
      console.log('')
      console.log('  ' + '─'.repeat(58))
      console.log(`  \x1b[31m⚠ ${brief.sessionsOnBuggyVersion} session${brief.sessionsOnBuggyVersion > 1 ? 's' : ''} ran on Claude Code 2.1.69-2.1.89 (known cache bug)\x1b[0m`)
      console.log(`  This bug causes 10-20x token burn from broken prompt caching.`)
      console.log(`  Fix: upgrade to v2.1.91+ with \x1b[1mclaude update\x1b[0m`)
    }

    console.log('')
  })

// ─── clauditor time ──────────────────────────────────────────────

program
  .command('time')
  .description('Analyze token usage by time of day — detect peak hour impact')
  .option('-d, --days <n>', 'Number of days to look back', '7')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { computeTimeAnalysis } = await import('./features/quota-report.js')
    const days = parseInt(options.days, 10) || 7
    const analysis = computeTimeAnalysis(days)

    if (options.json) {
      console.log(JSON.stringify(analysis, null, 2))
      return
    }

    const hasData = analysis.hourly.some(h => h.turns > 0)
    if (!hasData) {
      console.log('No session data found in the last ' + days + ' days.')
      return
    }

    console.log('')
    console.log(`  Token Usage by Hour — last ${days} days`)
    console.log('  ' + '─'.repeat(58))
    console.log('')

    const maxAvg = Math.max(...analysis.hourly.map(h => h.avgTokensPerTurn))

    for (const h of analysis.hourly) {
      if (h.turns === 0) continue
      const barLen = maxAvg > 0 ? Math.round((h.avgTokensPerTurn / maxAvg) * 30) : 0
      const bar = '█'.repeat(barLen)
      const isPeak = h.hour >= 9 && h.hour < 17
      const color = isPeak ? '\x1b[33m' : '\x1b[32m'
      const reset = '\x1b[0m'
      const hourStr = `${String(h.hour).padStart(2, '0')}:00`
      const cacheStr = `${Math.round(h.avgCacheRatio * 100)}%`

      console.log(
        `  ${hourStr}  ` +
        `${(Math.round(h.avgTokensPerTurn / 1000) + 'k').padStart(5)}/turn  ` +
        `${String(h.turns).padStart(4)} turns  ` +
        `cache ${cacheStr.padStart(4)}  ` +
        `${color}${bar}${reset}`
      )
    }

    console.log('')
    console.log('  ' + '─'.repeat(58))
    console.log(`  \x1b[33mPeak (9am-5pm):\x1b[0m    ${Math.round(analysis.peakAvgTokens / 1000)}k avg tokens/turn`)
    console.log(`  \x1b[32mOff-peak:\x1b[0m          ${Math.round(analysis.offPeakAvgTokens / 1000)}k avg tokens/turn`)

    if (analysis.peakMultiplier > 1.3) {
      console.log(`  \x1b[31mPeak multiplier:   ${analysis.peakMultiplier}x (peak hours cost ${analysis.peakMultiplier}x more per turn)\x1b[0m`)
    } else if (analysis.peakMultiplier > 1) {
      console.log(`  Peak multiplier:   ${analysis.peakMultiplier}x (minimal difference)`)
    } else {
      console.log(`  No significant peak/off-peak difference detected.`)
    }

    console.log('')
  })

// ─── clauditor share ─────────────────────────────────────────────

program
  .command('share')
  .description('Generate a shareable summary of your Claude Code usage')
  .option('-d, --days <n>', 'Number of days to look back', '7')
  .action(async (options) => {
    const { computeQuotaBrief } = await import('./features/quota-report.js')
    const days = parseInt(options.days, 10) || 7
    const brief = computeQuotaBrief(days)

    if (brief.totalSessions === 0) {
      console.log('No sessions found in the last ' + days + ' days.')
      return
    }

    const saved = brief.totalTokens - brief.tokensWithRotation
    const pctSaved = brief.totalTokens > 0 ? Math.round(saved / brief.totalTokens * 100) : 0

    const lines: string[] = []
    lines.push(`My Claude Code usage this week (via clauditor):`)
    lines.push('')
    lines.push(`• ${brief.totalSessions} sessions, ${brief.sessionsOver5x > 0 ? brief.sessionsOver5x + ' hit 5x+ waste' : 'all efficient'}`)
    lines.push(`• ${Math.round(brief.totalTokens / 1e6)}M tokens used`)

    if (pctSaved > 0) {
      lines.push(`• With session rotation: ${Math.round(brief.tokensWithRotation / 1e6)}M tokens (${pctSaved}% less quota)`)
    }

    if (brief.sessionsBlocked > 0) {
      lines.push(`• clauditor blocked ${brief.sessionsBlocked} session${brief.sessionsBlocked > 1 ? 's' : ''} before they burned more quota`)
    }

    if (brief.worstSession && brief.worstSession.wasteFactor >= 3) {
      const w = brief.worstSession
      lines.push(`• Worst session: ${w.turns} turns, ${w.wasteFactor}x waste (${w.baselineK}k→${w.currentK}k tokens/turn)`)
    }

    if (brief.avgCacheRatio > 0) {
      lines.push(`• Avg cache hit ratio: ${Math.round(brief.avgCacheRatio * 100)}%`)
    }

    lines.push('')
    lines.push(`npm install -g @iyadhk/clauditor`)

    const output = lines.join('\n')
    console.log(output)

    // Try to copy to clipboard
    try {
      const { execSync } = await import('node:child_process')
      const platform = process.platform
      if (platform === 'darwin') {
        execSync('pbcopy', { input: output })
        console.log('\n\x1b[32m✓ Copied to clipboard\x1b[0m')
      } else if (platform === 'linux') {
        try {
          execSync('xclip -selection clipboard', { input: output })
          console.log('\n\x1b[32m✓ Copied to clipboard\x1b[0m')
        } catch {
          try {
            execSync('xsel --clipboard --input', { input: output })
            console.log('\n\x1b[32m✓ Copied to clipboard\x1b[0m')
          } catch {
            // No clipboard tool available — that's fine
          }
        }
      }
    } catch {
      // Clipboard copy failed silently
    }
  })

// ─── clauditor sessions ──────────────────────────────────────────

program
  .command('sessions')
  .description('List recent sessions — see where your tokens went')
  .option('-d, --days <n>', 'Number of days to look back', '7')
  .option('-p, --project <path>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const { estimateCost, getPricingForModel } = await import('./features/cost-tracker.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
      projectPath: options.project ? resolve(options.project) : undefined,
    })

    if (!options.json) console.log('Scanning session files...')
    await watcher.scanAll()

    const daysAgo = parseInt(options.days) || 7
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysAgo)

    const sessions = store.getAll()
      .filter((s) => s.lastUpdated >= cutoff)
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())

    if (sessions.length === 0) {
      if (options.json) console.log('[]')
      else console.log('No sessions found.')
      return
    }

    if (options.json) {
      console.log(JSON.stringify(sessions.map((s) => {
        const pricing = s.model ? getPricingForModel(s.model) : undefined
        const cost = estimateCost(s.totalUsage, pricing)
        const lastTurn = s.turns[s.turns.length - 1]

        // Find token spike turns
        const avgTokens = s.turns.reduce((sum, t) =>
          sum + t.usage.input_tokens + t.usage.output_tokens +
          t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens, 0
        ) / (s.turns.length || 1)
        const spikeTurns = s.turns.filter((t) => {
          const total = t.usage.input_tokens + t.usage.output_tokens +
            t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
          return total > avgTokens * 3 && total > 100_000
        })

        return {
          label: s.label,
          model: s.model,
          turns: s.turns.length,
          lastUpdated: s.lastUpdated.toISOString(),
          cacheStatus: s.cacheHealth.status,
          cacheRatio: s.cacheHealth.lastCacheRatio,
          cost: cost.totalCost,
          spikeTurns: spikeTurns.length,
        }
      }), null, 2))
      return
    }

    console.log(`\nSessions from last ${daysAgo} days (${sessions.length} total):`)
    console.log('─'.repeat(80))

    for (const s of sessions) {
      const pricing = s.model ? getPricingForModel(s.model) : undefined
      const cost = estimateCost(s.totalUsage, pricing)
      const modelShort = s.model?.replace('claude-', '').split('-2')[0] || '?'
      const lastTurn = s.turns[s.turns.length - 1]

      // Cache ratio color
      const ratio = s.cacheHealth.lastCacheRatio
      const ratioStr = `${(ratio * 100).toFixed(0)}%`
      const cacheLabel = ratio >= 0.7 ? `\x1b[32m${ratioStr}\x1b[0m`
        : ratio >= 0.4 ? `\x1b[33m${ratioStr}\x1b[0m`
        : `\x1b[31m${ratioStr}\x1b[0m`

      // Find expensive turns (token spikes)
      const avgTokens = s.turns.reduce((sum, t) =>
        sum + t.usage.input_tokens + t.usage.output_tokens +
        t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens, 0
      ) / (s.turns.length || 1)
      const spikeTurns = s.turns.filter((t) => {
        const total = t.usage.input_tokens + t.usage.output_tokens +
          t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
        return total > avgTokens * 3 && total > 100_000
      })

      // Time
      const timeStr = formatTimeAgo(s.lastUpdated)

      console.log(
        `  ${s.label.slice(0, 35).padEnd(35)} ${modelShort.padEnd(10)} ` +
        `${String(s.turns.length).padStart(4)} turns  cache: ${cacheLabel.padEnd(15)}` +
        `~$${cost.totalCost.toFixed(2).padStart(8)}  ${timeStr}`
      )

      // Show spike warning
      if (spikeTurns.length > 0) {
        const maxSpike = Math.max(...spikeTurns.map((t) =>
          t.usage.input_tokens + t.usage.output_tokens +
          t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
        ))
        console.log(
          `  \x1b[31m  ⚠ ${spikeTurns.length} token spike${spikeTurns.length === 1 ? '' : 's'} detected ` +
          `(largest: ${(maxSpike / 1000).toFixed(0)}k tokens in one turn, avg: ${(avgTokens / 1000).toFixed(0)}k)\x1b[0m`
        )
      }

      // Show if cache was degraded
      if (s.cacheHealth.status === 'degraded' || s.cacheHealth.status === 'broken') {
        console.log(
          `  \x1b[33m  ⚠ Cache ${s.cacheHealth.status} — likely burned extra quota\x1b[0m`
        )
      }
    }

    console.log('')
  })

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ─── clauditor knowledge ─────────────────────────────────────────

program
  .command('knowledge')
  .description('Show accumulated project knowledge (errors, file activity)')
  .option('-p, --project <path>', 'Project directory', process.cwd())
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { readErrorIndex } = await import('./features/error-index.js')
    const { readFileIndex } = await import('./features/file-tracker.js')

    const cwd = resolve(options.project)
    const errors = readErrorIndex(cwd)
    const files = readFileIndex(cwd)

    if (options.json) {
      console.log(JSON.stringify({ errors, files }, null, 2))
      return
    }

    console.log('')
    console.log(`  Project Knowledge — ${cwd}`)
    console.log('  ' + '─'.repeat(58))

    // Errors
    if (errors.length > 0) {
      console.log('')
      console.log(`  \x1b[31mKnown Errors (${errors.length})\x1b[0m`)
      for (const e of errors.slice(0, 10)) {
        console.log(`  ${e.command.slice(0, 50)} — ${e.occurrences}x`)
        console.log(`    Error: ${e.error.slice(0, 80)}`)
        if (e.fix) console.log(`    \x1b[32mFix: ${e.fix.slice(0, 80)}\x1b[0m`)
      }
    } else {
      console.log('')
      console.log('  No errors recorded yet.')
    }

    // Files
    const hotFiles = Object.entries(files)
      .filter(([, f]) => f.editCount >= 3)
      .sort(([, a], [, b]) => b.editCount - a.editCount)

    if (hotFiles.length > 0) {
      console.log('')
      console.log(`  \x1b[33mFrequently Modified Files\x1b[0m`)
      for (const [name, f] of hotFiles.slice(0, 15)) {
        console.log(`  ${name.padEnd(40)} ${String(f.editCount).padStart(3)} edits  ${String(f.sessions).padStart(2)} sessions  last: ${f.lastEdited}`)
      }
    } else {
      console.log('')
      console.log('  No file activity recorded yet.')
    }

    console.log('')
    console.log('  Knowledge accumulates automatically as you use Claude Code.')
    console.log('')
  })

// ─── clauditor suggest-skill ─────────────────────────────────────

program
  .command('suggest-skill')
  .description('Find repeating workflows and suggest saving them as skills')
  .option('-p, --project <path>', 'Scan a specific project')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = await loadConfig()
    const { SessionStore } = await import('./daemon/store.js')
    const { SessionWatcher } = await import('./daemon/watcher.js')
    const {
      detectWorkflowPatterns,
      generateSkillSuggestions,
      formatSkillSuggestions,
    } = await import('./features/skill-suggest.js')

    const store = new SessionStore()
    const watcher = new SessionWatcher(store, {
      projectsDir: config.watch.projectsDir,
      projectPath: options.project ? resolve(options.project) : undefined,
    })

    if (!options.json) console.log('Scanning session files for repeating workflows...')
    await watcher.scanAll()

    const sessions = store.getAll()
    const patterns = detectWorkflowPatterns(sessions)
    const suggestions = generateSkillSuggestions(patterns)

    if (options.json) {
      console.log(JSON.stringify(suggestions.map((s) => ({
        name: s.name,
        sessionCount: s.pattern.sessionCount,
        steps: s.pattern.steps,
        seenIn: s.pattern.seenIn,
      })), null, 2))
      return
    }

    console.log('\nSkill suggestions')
    console.log('─'.repeat(55))

    if (suggestions.length === 0) {
      console.log('  No repeating workflows found yet.')
      console.log('  Use Claude Code for a few more sessions — patterns emerge over time.')
    } else {
      console.log(formatSkillSuggestions(suggestions))
      console.log('  To enable automatic suggestions, run: clauditor install')
      console.log('  Claude will offer to create these skills at session start.')
    }
    console.log('')
  })

// ─── clauditor hook <name> ───────────────────────────────────────

const hookCmd = program
  .command('hook')
  .description('Internal hook handlers (called by Claude Code)')

hookCmd
  .command('stop')
  .description('Stop hook handler')
  .action(async () => {
    await import('./hooks/stop.js')
  })

hookCmd
  .command('post-tool-use')
  .description('PostToolUse hook handler')
  .action(async () => {
    await import('./hooks/post-tool-use.js')
  })

hookCmd
  .command('pre-tool-use')
  .description('PreToolUse hook handler')
  .action(async () => {
    await import('./hooks/pre-tool-use.js')
  })

hookCmd
  .command('user-prompt-submit')
  .description('UserPromptSubmit hook handler — blocks oversized sessions')
  .action(async () => {
    await import('./hooks/user-prompt-submit.js')
  })

hookCmd
  .command('pre-compact')
  .description('PreCompact hook handler — saves context before compaction')
  .action(async () => {
    await import('./hooks/pre-compact.js')
  })

hookCmd
  .command('post-compact')
  .description('PostCompact hook handler — captures Claude\'s own session summary')
  .action(async () => {
    await import('./hooks/post-compact.js')
  })

hookCmd
  .command('session-start')
  .description('SessionStart hook handler')
  .action(async () => {
    await import('./hooks/session-start.js')
  })

// ─── Config loader ───────────────────────────────────────────────

async function loadConfig(): Promise<ClauditorConfig> {
  try {
    const explorer = cosmiconfig('clauditor')
    const result = await explorer.search()
    if (result?.config) {
      return {
        ...DEFAULT_CONFIG,
        ...result.config,
        pricing: { ...DEFAULT_CONFIG.pricing, ...result.config.pricing },
        alerts: { ...DEFAULT_CONFIG.alerts, ...result.config.alerts },
        bashFilter: { ...DEFAULT_CONFIG.bashFilter, ...result.config.bashFilter },
        watch: { ...DEFAULT_CONFIG.watch, ...result.config.watch },
        rotation: { ...DEFAULT_CONFIG.rotation, ...result.config.rotation },
      }
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_CONFIG
}

// Check for updates (cached, non-blocking) — skip for hook subcommands
const args = process.argv.slice(2)
const isHook = args[0] === 'hook'

if (!isHook) {
  try {
    const { checkForUpdate, getInstallMethod, getUpgradeCommand } = await import('./features/update-check.js')
    const latest = checkForUpdate(pkg.version)
    if (latest) {
      const cmd = getUpgradeCommand(getInstallMethod())
      // Show after command output
      process.on('exit', () => {
        console.error(`\n  clauditor update available: ${pkg.version} → ${latest}`)
        console.error(`  Run: ${cmd}\n`)
      })
    }
  } catch {}
}

// ─── clauditor handoff-report ────────────────────────────────────

program
  .command('handoff-report')
  .description('Measure information preservation of the last session handoff')
  .option('-t, --transcript <path>', 'Path to a specific transcript JSONL file')
  .option('-s, --summary <path>', 'Path to a specific handoff summary file')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { extractFacts, scoreHandoff, generateReport } = await import('./features/handoff-quality.js')
    const { readRecentHandoffs } = await import('./features/session-state.js')

    // Find transcript
    let transcriptPath = options.transcript
    if (!transcriptPath) {
      // Auto-detect: find the most recent transcript in ~/.claude/projects/
      const claudeDir = resolve(homedir(), '.claude', 'projects')
      try {
        const projectDirs = readdirSync(claudeDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
        // Find the most recent transcript that's large enough to have meaningful facts
        // Skip tiny transcripts (< 50KB / ~10 turns) — they produce "no facts found"
        const MIN_TRANSCRIPT_BYTES = 50_000
        const candidates: Array<{ path: string; mtime: number; size: number }> = []
        for (const dir of projectDirs) {
          const dirPath = resolve(claudeDir, dir.name)
          try {
            const files = readdirSync(dirPath).filter(f => f.endsWith('.jsonl'))
            for (const f of files) {
              const fp = resolve(dirPath, f)
              const st = statSync(fp)
              candidates.push({ path: fp, mtime: st.mtimeMs, size: st.size })
            }
          } catch {}
        }
        // Sort by recency, pick the most recent one that's large enough
        candidates.sort((a, b) => b.mtime - a.mtime)
        const viable = candidates.find(c => c.size >= MIN_TRANSCRIPT_BYTES)
        if (viable) transcriptPath = viable.path
      } catch {}
    }

    if (!transcriptPath) {
      console.error('No transcript found. Specify one with --transcript <path>')
      process.exit(1)
    }

    // Extract cwd from transcript to match with the right handoff
    let transcriptCwd: string | null = null
    try {
      const lines = readFileSync(transcriptPath, 'utf-8').split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const r = JSON.parse(lines[i])
          if (r.type === 'user' && r.cwd) {
            transcriptCwd = r.cwd
            break
          }
        } catch {}
      }
    } catch {}

    // Find handoff summary — match by project if possible
    let summaryContent: string
    if (options.summary) {
      summaryContent = readFileSync(options.summary, 'utf-8')
    } else {
      const handoffs = readRecentHandoffs()
      if (handoffs.length === 0) {
        console.error('No recent handoff found. Specify one with --summary <path>')
        process.exit(1)
      }
      // Prefer handoff from the same project as the transcript
      const matched = transcriptCwd
        ? handoffs.find(h => h.project === transcriptCwd || h.content.includes(transcriptCwd!))
        : null
      summaryContent = (matched || handoffs[0]).content
    }

    // Extract and score
    const facts = extractFacts(transcriptPath)
    if (facts.length === 0) {
      console.log('No verifiable facts found in the transcript.')
      return
    }

    const score = scoreHandoff(facts, summaryContent)

    if (options.json) {
      console.log(JSON.stringify({ ...score, transcriptPath, project: transcriptCwd }, null, 2))
    } else {
      if (transcriptCwd) {
        const projectName = transcriptCwd.split('/').pop() || transcriptCwd
        console.log(`Project: ${projectName}\n`)
      }
      console.log(generateReport(score))
    }
  })

// Default command: if no subcommand given, run `report`
if (process.argv.length <= 2) {
  process.argv.push('report')
}

program.parse()
