import { Command } from 'commander'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { cosmiconfig } from 'cosmiconfig'
import { DEFAULT_CONFIG } from './types.js'
import type { ClauditorConfig } from './types.js'
import { readConfig } from './config.js'
import { initLocaleFromEnv, t } from './i18n.js'

// Activate locale before any command description or action runs
initLocaleFromEnv(readConfig().locale)

// Read version from package.json so it stays in sync with releases
const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

const program = new Command()

program
  .name('clauditor')
  .description(t('cli.description'))
  .version(pkg.version)

// ─── clauditor watch ──────────────────────────────────────────────

program
  .command('watch')
  .description(t('cli.cmd.watch.desc'))
  .option('-p, --project <path>', t('cli.cmd.watch.opt.project'))
  .option('-a, --all', t('cli.cmd.watch.opt.all'))
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
  .description(t('cli.cmd.status.desc'))
  .option('-p, --project <path>', t('cli.cmd.status.opt.project'))
  .option('--json', t('cli.cmd.status.opt.json'))
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
        console.log(t('status.noSessions'))
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
    console.log(`${cacheColor}${t('status.cacheLine', { ratio: (s.cacheHealth.lastCacheRatio * 100).toFixed(0), status: s.cacheHealth.status })}${reset}`)
    console.log(`${ctxColor}${t('status.contextLine', { pct: contextPct, cur: (contextSize / 1000).toFixed(0), max: (contextLimit / 1000).toFixed(0) })}${reset}`)

    if (s.loopState.loopDetected) {
      console.log(`\x1b[31m${t('status.loopLine', { pattern: s.loopState.loopPattern ?? '', count: s.loopState.consecutiveIdenticalTurns })}\x1b[0m`)
    }

    console.log(t('status.costLine', { cost: cost.totalCost.toFixed(2), saved: cost.savedVsUncached.toFixed(2) }))

    // Show issues
    if (s.cacheHealth.degradationDetected) {
      console.log(`\n  \x1b[31m${t('status.slowCache')}\x1b[0m`)
      console.log(`    ${t('status.slowCacheFix')}`)
    }
    if (contextPct >= 95) {
      console.log(`\n  \x1b[31m${t('status.contextFull')}\x1b[0m`)
      console.log(`    ${t('status.contextFullFix')}`)
    } else if (contextPct >= 80) {
      console.log(`\n  \x1b[33m${t('status.contextFilling', { pct: contextPct })}\x1b[0m`)
      console.log(`    ${t('status.contextFillingFix')}`)
    }

    if (!s.cacheHealth.degradationDetected && contextPct < 80 && !s.loopState.loopDetected) {
      console.log(`\n  \x1b[32m${t('status.allClear')}\x1b[0m`)
    }

    console.log('')
  })

// ─── clauditor install ────────────────────────────────────────────

program
  .command('install')
  .description(t('cli.cmd.install.desc'))
  .option('--claude-dir <path>', t('cli.cmd.install.opt.claudeDir'))
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
  .description(t('cli.cmd.uninstall.desc'))
  .option('--claude-dir <path>', t('cli.cmd.install.opt.claudeDir'))
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
  .description(t('cli.cmd.login.desc'))
  .option('--hub-url <url>', t('cli.cmd.login.opt.hubUrl'), DEFAULT_HUB_URL)
  .option('--device', t('cli.cmd.login.opt.device'))
  .action(async (options) => {
    const { createHash } = await import('node:crypto')
    const { hostname, userInfo } = await import('node:os')
    const { setProjectHubConfig } = await import('./config.js')
    const { getGitRemoteUrl, getProjectHash } = await import('./hub/git-project.js')

    const remoteUrl = getGitRemoteUrl()
    if (!remoteUrl) {
      console.error(t('login.errNoRepo'))
      console.error(t('login.errNoRepoHint1'))
      console.error(t('login.errNoRepoHint2'))
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
          console.log(t('login.settingUpHooks'))
          const { installHooks } = await import('./install.js')
          const msgs = await installHooks()
          msgs.forEach((m: string) => console.log(m))
        }
      } else {
        console.log(t('login.settingUpHooks'))
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

  console.log(t('login.openingBrowser'))
  console.log(t('login.browserFallbackHint'))
  console.log(`  ${authUrl}\n`)

  try {
    const open = (await import('open')).default
    await open(authUrl)
  } catch {
    // Browser open failed — user will use the printed URL
  }

  console.log(t('login.waitingAuth'))

  try {
    const result = await waitForResult()

    console.log(t('login.loggedInTeam', { team: result.teamName, plan: result.plan }))

    // Fetch projects and let user pick one
    const selectedProject = await pickProject(hubUrl, result.apiKey)

    setProjectHubConfig(remoteUrl, {
      apiKey: result.apiKey,
      url: hubUrl,
      developerHash,
      teamName: result.teamName,
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      projectHash: selectedProject.hash,
    })

    console.log(t('login.connectedProject', { project: selectedProject.name }))

    // Sync local auto-memory to the selected project
    try {
      const { readAutoMemory, syncMemoryToHub } = await import('./hub/memory-sync.js')
      const memories = readAutoMemory(process.cwd())
      if (memories.length > 0) {
        const syncResult = await syncMemoryToHub(memories, selectedProject.hash, developerHash, { apiKey: result.apiKey, url: hubUrl })
        if (syncResult.synced > 0) {
          console.log(t('login.memoriesSynced', { count: syncResult.synced }))
        }
      }
    } catch {}

    // Show brief count
    try {
      const briefRes = await fetch(`${hubUrl}/api/v1/knowledge/brief?project_hash=${selectedProject.hash}&max=1`, {
        headers: { 'X-Clauditor-Key': result.apiKey },
        signal: AbortSignal.timeout(5000),
      })
      if (briefRes.ok) {
        const briefData = await briefRes.json() as { brief: Array<{ title: string }>; sources?: Record<string, number> }
        const total = Object.values(briefData.sources || {}).reduce((a, b) => a + b, 0)
        if (total > 0) {
          console.log(t('login.knowledgeAvailable', { count: total }))
        }
      }
    } catch {}

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
      console.log(t('login.mcpAlreadyConfigured'))
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
          rl.question(t('login.mcpPrompt'), (ans) => {
            rl.close()
            resolve(ans.trim().toLowerCase())
          })
        })

        if (answer !== 'n' && answer !== 'no') {
          try {
            const { execSync } = await import('node:child_process')
            try { execSync('claude mcp remove clauditor 2>/dev/null', { stdio: 'ignore' }) } catch {}
            execSync(`claude mcp add --transport http -s user clauditor "${mcpUrl}"`, { stdio: 'inherit' })
            console.log(t('login.mcpConfigured'))
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
              console.log(t('login.mcpConfiguredSettings'))
            } catch {
              console.log(t('login.mcpManual'))
              console.log(`  claude mcp add --transport http -s user clauditor "${mcpUrl}"`)
            }
          }
        } else {
          console.log(t('login.mcpLater'))
          console.log(`  claude mcp add --transport http -s user clauditor "${mcpUrl}"`)
        }
      }
    }
  } catch (err) {
    console.error(t('login.errGeneric', { error: err instanceof Error ? err.message : String(err) }))
    process.exit(1)
  }
}

/**
 * Fetch projects from the hub and let the user pick one.
 * Only admins can create projects (via dashboard). Developers pick from existing.
 */
async function pickProject(
  hubUrl: string,
  apiKey: string,
): Promise<{ id: string; name: string; hash: string }> {
  const readline = await import('node:readline')

  const res = await fetch(`${hubUrl}/api/v1/projects/list`, {
    headers: { 'X-Clauditor-Key': apiKey },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) throw new Error(t('pickProject.errFetch'))

  const data = await res.json() as {
    projects: Array<{ id: string; name: string; project_hash: string }>
  }

  if (data.projects.length === 0) {
    throw new Error(t('pickProject.errNoProjects'))
  }

  console.log(t('pickProject.prompt'))
  for (let i = 0; i < data.projects.length; i++) {
    console.log(`    ${i + 1}. ${data.projects[i].name}`)
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise<string>((resolve) => {
    rl.question(t('pickProject.choicePrompt', { max: data.projects.length }), (ans) => {
      rl.close()
      resolve(ans.trim())
    })
  })

  const choice = parseInt(answer, 10)
  if (choice < 1 || choice > data.projects.length) {
    throw new Error(t('pickProject.errInvalid'))
  }

  const p = data.projects[choice - 1]
  return { id: p.id, name: p.name, hash: p.project_hash }
}

async function loginDeviceFlow(hubUrl: string, remoteUrl: string, developerHash: string) {
  const { requestDeviceCode, pollForToken } = await import('./hub/device-flow.js')
  const { setProjectHubConfig } = await import('./config.js')
  const { getProjectHash } = await import('./hub/git-project.js')

  console.log(t('login.requestingDeviceCode'))

  try {
    const projectHash = getProjectHash() || undefined
    const codes = await requestDeviceCode(hubUrl, projectHash, developerHash)

    console.log(t('login.deviceVisit', { url: codes.verification_url }))
    console.log(t('login.deviceCode', { code: codes.user_code }))
    console.log(t('login.waitingConfirmation'))

    const result = await pollForToken(hubUrl, codes.device_code, codes.interval, codes.expires_in)

    setProjectHubConfig(remoteUrl, {
      apiKey: result.api_key,
      url: hubUrl,
      developerHash,
      teamName: result.team_name,
    })

    console.log(t('login.loggedInTeam', { team: result.team_name, plan: result.plan }))
    console.log(t('login.deviceConnected', { remote: remoteUrl, team: result.team_name }))
    console.log(t('login.syncNote'))
    console.log(t('login.nextInit'))
  } catch (err) {
    console.error(t('login.errGeneric', { error: err instanceof Error ? err.message : String(err) }))
    process.exit(1)
  }
}

// ─── clauditor init ──────────────────────────────────────────────

program
  .command('init')
  .description(t('cli.cmd.init.desc'))
  .option('--tool <tool>', t('cli.cmd.init.opt.tool'))
  .option('--hub-url <url>', t('cli.cmd.login.opt.hubUrl'), DEFAULT_HUB_URL)
  .option('-y, --yes', t('cli.cmd.init.opt.yes'))
  .action(async (options: { tool?: string; hubUrl?: string; yes?: boolean }) => {
    const { getGitRemoteUrl } = await import('./hub/git-project.js')
    const { getProjectHubConfig } = await import('./config.js')
    const {
      detectTool,
      pathForTool,
      writeInstruction,
      notifyHub,
      INSTRUCTION_BLOCK,
    } = await import('./hub/init-instruction.js')

    const remoteUrl = getGitRemoteUrl()
    const cwd = process.cwd()

    // Resolve tool: --tool flag → detection → interactive prompt
    const validTools = ['claude_code', 'codex', 'cursor', 'claude_desktop', 'other'] as const
    type Tool = typeof validTools[number]

    let tool: Tool | null = null
    if (options.tool) {
      if (!validTools.includes(options.tool as Tool)) {
        console.error(t('init.errUnknownTool', { tool: options.tool, valid: validTools.join(', ') }))
        process.exit(1)
      }
      tool = options.tool as Tool
    } else {
      const detected = detectTool(cwd)
      if (detected) {
        tool = detected
        console.log(t('init.detected', { tool }))
      } else {
        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        console.log(t('init.whichTool'))
        validTools.forEach((name, i) => console.log(`    ${i + 1}. ${name}`))
        const answer = await new Promise<string>((r) => rl.question(t('init.choice5'), (a) => { rl.close(); r(a.trim()) }))
        const choice = parseInt(answer, 10)
        if (!choice || choice < 1 || choice > validTools.length) {
          console.error(t('init.errInvalidChoice'))
          process.exit(1)
        }
        tool = validTools[choice - 1]
      }
    }

    const target = pathForTool(tool)

    if (!target) {
      console.log(tool === 'claude_desktop' ? t('init.noConfigFileClaudeDesktop') : t('init.noConfigFileOther'))
      console.log(t('init.pasteHint'))
      console.log('  ─────────────────────────────────────────────')
      console.log(INSTRUCTION_BLOCK.split('\n').map((l) => '  ' + l).join('\n'))
      console.log('  ─────────────────────────────────────────────')
      console.log(t('init.addedHint'))
      return
    }

    // Confirm before writing (skip with --yes)
    if (!options.yes) {
      const readline = await import('node:readline')
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>((r) =>
        rl.question(t('init.writePrompt', { target }), (a) => { rl.close(); r(a.trim().toLowerCase()) })
      )
      if (answer === 'n' || answer === 'no') {
        console.log(t('init.aborted'))
        return
      }
    }

    const result = writeInstruction(cwd, tool)
    if (result.status === 'manual_required') {
      // Shouldn't reach here — pathForTool already filtered, but be safe.
      console.log(t('init.manualRequired', { tool }))
      return
    }

    if (result.status === 'already_present') {
      console.log(t('init.alreadyPresent', { path: result.path }))
    } else {
      console.log(result.created ? t('init.created', { path: result.path }) : t('init.updated', { path: result.path }))
    }

    // Notify hub (best-effort — older hubs lack this endpoint)
    if (remoteUrl) {
      const hubCfg = getProjectHubConfig(remoteUrl)
      if (hubCfg?.apiKey) {
        const hubUrl = options.hubUrl || hubCfg.url || DEFAULT_HUB_URL
        const ok = await notifyHub(hubUrl, hubCfg.apiKey)
        if (ok) {
          console.log(t('init.dashboardMarked'))
        }
      } else {
        console.log(t('init.loginHint'))
      }
    }
  })

// ─── clauditor sync ──────────────────────────────────────────────

program
  .command('sync')
  .description(t('cli.cmd.sync.desc'))
  .action(async () => {
    const { resolveHubContext } = await import('./hub/client.js')
    const hub = resolveHubContext()
    if (!hub) {
      console.error(t('sync.errNotConnected'))
      process.exit(1)
    }

    console.log(t('sync.syncingTo', { target: hub.config.teamName || 'hub' }))

    let totalPushed = 0

    // 1. Sync auto-memory
    try {
      const { readAutoMemory, syncMemoryToHub } = await import('./hub/memory-sync.js')
      const memories = readAutoMemory(process.cwd())
      if (memories.length > 0) {
        const result = await syncMemoryToHub(memories, hub.projectHash, hub.config.developerHash, hub.config, hub.remoteUrl)
        if (result.synced > 0) {
          console.log(t('sync.memoriesSynced', { count: result.synced }))
          totalPushed += result.synced
        } else {
          console.log(t('sync.memoriesUpToDate'))
        }
      } else {
        console.log(t('sync.memoriesNone'))
      }
    } catch (err) {
      console.error(t('sync.memoriesFailed', { error: err instanceof Error ? err.message : String(err) }))
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
              console.error(t('sync.summaryPushFailed', { error: data.error || `synced=${data.synced} skipped=${data.skipped}` }))
            }
          } catch (err) {
            console.error(t('sync.summaryPushError', { error: err instanceof Error ? err.message : String(err) }))
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
        console.log(t('sync.learnings', { count: handoffLearnings }))
        totalPushed += handoffLearnings
      }
      if (summariesPushed > 0) {
        console.log(t('sync.summaries', { count: summariesPushed }))
        totalPushed += summariesPushed
      }
      if (handoffLearnings === 0 && summariesPushed === 0 && handoffs.length === 0) {
        console.log(t('sync.handoffsNone'))
      }
    } catch (err) {
      console.error(t('sync.handoffFailed', { error: err instanceof Error ? err.message : String(err) }))
    }

    // 3. Flush push queue (retries for anything that failed earlier)
    try {
      const { flushQueue } = await import('./hub/push-queue.js')
      const { sent } = await flushQueue()
      if (sent > 0) {
        console.log(t('sync.queueFlushed', { count: sent }))
        totalPushed += sent
      }
    } catch {}

    if (totalPushed > 0) {
      console.log(t('sync.totalSynced', { count: totalPushed }))
    } else {
      console.log(t('sync.upToDate'))
    }
  })

// ─── clauditor stats ─────────────────────────────────────────────

program
  .command('stats')
  .description(t('cli.cmd.stats.desc'))
  .option('-d, --days <n>', t('cli.cmd.stats.opt.days'), '7')
  .option('-p, --project <path>', t('cli.cmd.stats.opt.project'))
  .option('--json', t('cli.cmd.status.opt.json'))
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

    if (!options.json) console.log(t('common.scanning'))
    await watcher.scanAll()

    const sessions = store.getAll()
    if (sessions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ sessions: 0 }))
      } else {
        console.log(t('common.noSessions'))
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

    console.log(t('stats.header', { days: daysAgo }))
    console.log('─'.repeat(50))
    console.log(t('stats.sessions', { count: recentSessions.length }))
    console.log(t('stats.totalTokens', { count: totalTokens.toLocaleString() }))
    console.log(t('stats.input', { count: totalUsage.input_tokens.toLocaleString() }))
    console.log(t('stats.output', { count: totalUsage.output_tokens.toLocaleString() }))
    console.log(t('stats.cacheReads', { count: totalUsage.cache_read_input_tokens.toLocaleString() }))
    console.log(t('stats.cacheWrites', { count: totalUsage.cache_creation_input_tokens.toLocaleString() }))

    console.log(t('stats.estCost', { cost: cost.totalCost.toFixed(2) }))
    console.log(t('stats.savedByCache', { cost: cost.savedVsUncached.toFixed(2) }))
    console.log(t('stats.cacheEfficiency', { pct: (cacheRatio * 100).toFixed(1) }))

    if (toolCounts.size > 0) {
      console.log(t('stats.toolCalls'))
      const sorted = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])
      for (const [name, count] of sorted.slice(0, 10)) {
        console.log(`    ${name.padEnd(20)} ${count}`)
      }
    }

    console.log(t('stats.topSessions'))
    for (const s of topSessions) {
      console.log(
        `    ${s.label.slice(0, 25).padEnd(25)}  ~$${s.cost.toFixed(2).padStart(8)}  ${String(s.turns).padStart(4)} turns  ${s.model.padEnd(10)}  cache: ${s.cacheStatus}`
      )
    }
  })

// ─── clauditor check-memory ──────────────────────────────────────

program
  .command('check-memory')
  .description(t('cli.cmd.checkMemory.desc'))
  .option('-p, --project <path>', t('cli.cmd.checkMemory.opt.project'), '.')
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
  .description(t('cli.cmd.doctor.desc'))
  .option('-p, --project <path>', t('cli.cmd.doctor.opt.project'))
  .option('--json', t('cli.cmd.status.opt.json'))
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

    if (!options.json) console.log(t('common.scanning'))
    await watcher.scanAll()

    const sessions = store.getAll()
    if (sessions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ sessions: 0, issues: [] }))
      } else {
        console.log(t('common.noSessions'))
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
      console.log(t('doctor.noIssues', { count: sessions.length }))
      return
    }

    console.log(t('doctor.foundIssues', { count: issues.length }))

    for (const issue of issues) {
      const icon = issue.severity === 'broken' ? '✗' : '⚠'
      const severityLabel = issue.severity === 'broken'
        ? t('doctor.brokenLabel')
        : t('doctor.degradedLabel')

      console.log(`  ${icon} ${issue.label}`)
      console.log(`    ${severityLabel}`)
      console.log(t('doctor.turnsRatio', { turns: issue.turns, pct: (issue.cacheRatio * 100).toFixed(0) }))
      console.log(t('doctor.trendLabel', { trend: issue.trend.map((r) => `${(r * 100).toFixed(0)}%`).join(' → ') }))

      if (issue.severity === 'broken') {
        console.log(t('doctor.brokenFix'))
      }
      console.log('')
    }
  })

// ─── clauditor impact ────────────────────────────────────────────

program
  .command('impact')
  .description(t('cli.cmd.impact.desc'))
  .option('--json', t('cli.cmd.status.opt.json'))
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

    if (!options.json) console.log(t('common.scanning'))
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
  .description(t('cli.cmd.activity.desc'))
  .option('-n, --limit <n>', t('cli.cmd.activity.opt.limit'), '20')
  .option('--json', t('cli.cmd.status.opt.json'))
  .action(async (options) => {
    const { readActivity, formatActivity } = await import('./features/activity-log.js')
    const limit = parseInt(options.limit) || 20
    const events = await readActivity(limit)

    if (options.json) {
      console.log(JSON.stringify(events, null, 2))
      return
    }

    console.log(t('activity.header'))
    console.log('─'.repeat(50))
    console.log(formatActivity(events))
    console.log('')
  })

// ─── clauditor calibrate ──────────────────────────────────────────

program
  .command('calibrate')
  .description(t('cli.cmd.calibrate.desc'))
  .option('--json', t('cli.cmd.status.opt.json'))
  .action(async (options) => {
    const { calibrate, formatCalibration } = await import('./features/calibration.js')

    if (!options.json) console.log(t('calibrate.scanning'))
    const result = calibrate()

    if (options.json) {
      const { sessionProfiles, ...summary } = result
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    console.log('\n' + formatCalibration(result))

    if (result.confident) {
      console.log(t('calibrate.success', { threshold: result.wasteThreshold, minTurns: result.minTurns }))
    } else {
      console.log(t('calibrate.notEnough'))
      console.log(t('calibrate.notEnoughHint'))
    }
    console.log('')
  })

// ─── clauditor report ────────────────────────────────────────────

program
  .command('report')
  .description(t('cli.cmd.report.desc'))
  .option('-d, --days <n>', t('cli.cmd.report.opt.days'), '7')
  .option('--json', t('cli.cmd.status.opt.json'))
  .action(async (options) => {
    const { computeQuotaBrief } = await import('./features/quota-report.js')
    const days = parseInt(options.days, 10) || 7
    const brief = computeQuotaBrief(days)

    if (options.json) {
      console.log(JSON.stringify(brief, null, 2))
      return
    }

    if (brief.totalSessions === 0) {
      console.log(t('common.noSessionsInRange', { days }))
      return
    }

    console.log('')
    console.log(t('report.header', { days }))
    console.log('  ' + '─'.repeat(58))
    console.log('')
    console.log(t('report.columns'))
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
    console.log(t('report.summary', { sessions: brief.totalSessions, tokensM: (brief.totalTokens / 1e6).toFixed(0) }))
    if (brief.sessionsOver5x > 0) {
      console.log(`  \x1b[31m${t('report.over5x', { count: brief.sessionsOver5x })}\x1b[0m`)
    }
    if (brief.sessionsOver3x > 0 && brief.sessionsOver3x > brief.sessionsOver5x) {
      console.log(`  \x1b[33m${t('report.over3x', { count: brief.sessionsOver3x - brief.sessionsOver5x })}\x1b[0m`)
    }

    if (brief.worstSession && brief.worstSession.wasteFactor >= 3) {
      const w = brief.worstSession
      console.log('')
      console.log(t('report.worstLabel', { label: w.label, turns: w.turns }))
      console.log(t('report.worstDetail', { base: w.baselineK, now: w.currentK, waste: w.wasteFactor }))
      console.log(t('report.worstCounterfactual', { savedM: Math.round(w.turns * w.baselineK * 2 / 1000), actualM: Math.round(w.totalTokens / 1e6) }))
    }

    // Clauditor impact
    const saved = brief.totalTokens - brief.tokensWithRotation
    if (saved > 0) {
      const pctSaved = Math.round(saved / brief.totalTokens * 100)
      console.log('')
      console.log('  ' + '─'.repeat(58))
      console.log(`  \x1b[36m${t('report.impactHeader').trim()}\x1b[0m`)
      if (brief.sessionsBlocked > 0) {
        console.log(t('report.impactBlocked', { count: brief.sessionsBlocked, plural: brief.sessionsBlocked > 1 ? 's' : '' }))
      }
      console.log(t('report.impactRotation', { withM: Math.round(brief.tokensWithRotation / 1e6), actualM: Math.round(brief.totalTokens / 1e6) }))
      console.log(`  \x1b[32m${t('report.impactSavings', { savedM: Math.round(saved / 1e6), pct: pctSaved }).trim()}\x1b[0m`)
    }

    if (brief.sessionsOnBuggyVersion > 0) {
      console.log('')
      console.log('  ' + '─'.repeat(58))
      console.log(`  \x1b[31m${t('report.buggyVersion', { count: brief.sessionsOnBuggyVersion, plural: brief.sessionsOnBuggyVersion > 1 ? 's' : '' }).trim()}\x1b[0m`)
      console.log(t('report.buggyDetail'))
      console.log(t('report.buggyFix'))
    }

    console.log('')
  })

// ─── clauditor time ──────────────────────────────────────────────

program
  .command('time')
  .description(t('cli.cmd.time.desc'))
  .option('-d, --days <n>', t('cli.cmd.report.opt.days'), '7')
  .option('--json', t('cli.cmd.status.opt.json'))
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
      console.log(t('common.noSessionsInRange', { days }))
      return
    }

    console.log('')
    console.log(t('time.header', { days }))
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
    console.log(`  \x1b[33m${t('time.peakLabel', { k: Math.round(analysis.peakAvgTokens / 1000) }).trim()}\x1b[0m`)
    console.log(`  \x1b[32m${t('time.offPeakLabel', { k: Math.round(analysis.offPeakAvgTokens / 1000) }).trim()}\x1b[0m`)

    if (analysis.peakMultiplier > 1.3) {
      console.log(`  \x1b[31m${t('time.peakMultiplierHi', { x: analysis.peakMultiplier }).trim()}\x1b[0m`)
    } else if (analysis.peakMultiplier > 1) {
      console.log(t('time.peakMultiplierLo', { x: analysis.peakMultiplier }))
    } else {
      console.log(t('time.noDiff'))
    }

    console.log('')
  })

// ─── clauditor share ─────────────────────────────────────────────

program
  .command('share')
  .description(t('cli.cmd.share.desc'))
  .option('-d, --days <n>', t('cli.cmd.report.opt.days'), '7')
  .action(async (options) => {
    const { computeQuotaBrief } = await import('./features/quota-report.js')
    const days = parseInt(options.days, 10) || 7
    const brief = computeQuotaBrief(days)

    if (brief.totalSessions === 0) {
      console.log(t('common.noSessionsInRange', { days }))
      return
    }

    const saved = brief.totalTokens - brief.tokensWithRotation
    const pctSaved = brief.totalTokens > 0 ? Math.round(saved / brief.totalTokens * 100) : 0

    const lines: string[] = []
    lines.push(t('share.header'))
    lines.push('')
    const wasteClause = brief.sessionsOver5x > 0
      ? t('share.over5x', { count: brief.sessionsOver5x })
      : t('share.allEfficient')
    lines.push(t('share.sessions', { count: brief.totalSessions, waste: wasteClause }))
    lines.push(t('share.tokens', { m: Math.round(brief.totalTokens / 1e6) }))

    if (pctSaved > 0) {
      lines.push(t('share.rotation', { m: Math.round(brief.tokensWithRotation / 1e6), pct: pctSaved }))
    }

    if (brief.sessionsBlocked > 0) {
      lines.push(t('share.blocked', { count: brief.sessionsBlocked, plural: brief.sessionsBlocked > 1 ? 's' : '' }))
    }

    if (brief.worstSession && brief.worstSession.wasteFactor >= 3) {
      const w = brief.worstSession
      lines.push(t('share.worst', { turns: w.turns, waste: w.wasteFactor, base: w.baselineK, now: w.currentK }))
    }

    if (brief.avgCacheRatio > 0) {
      lines.push(t('share.cacheAvg', { pct: Math.round(brief.avgCacheRatio * 100) }))
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
        console.log(`\x1b[32m${t('share.copied')}\x1b[0m`)
      } else if (platform === 'linux') {
        try {
          execSync('xclip -selection clipboard', { input: output })
          console.log(`\x1b[32m${t('share.copied')}\x1b[0m`)
        } catch {
          try {
            execSync('xsel --clipboard --input', { input: output })
            console.log(`\x1b[32m${t('share.copied')}\x1b[0m`)
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
  .description(t('cli.cmd.sessions.desc'))
  .option('-d, --days <n>', t('cli.cmd.report.opt.days'), '7')
  .option('-p, --project <path>', t('cli.cmd.sessions.opt.project'))
  .option('--json', t('cli.cmd.status.opt.json'))
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

    if (!options.json) console.log(t('common.scanning'))
    await watcher.scanAll()

    const daysAgo = parseInt(options.days) || 7
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysAgo)

    const sessions = store.getAll()
      .filter((s) => s.lastUpdated >= cutoff)
      .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())

    if (sessions.length === 0) {
      if (options.json) console.log('[]')
      else console.log(t('common.noSessionsSimple'))
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

    console.log(t('sessions.header', { days: daysAgo, count: sessions.length }))
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
        const maxSpike = Math.max(...spikeTurns.map((turn) =>
          turn.usage.input_tokens + turn.usage.output_tokens +
          turn.usage.cache_creation_input_tokens + turn.usage.cache_read_input_tokens
        ))
        console.log(
          `  \x1b[31m${t('sessions.spikes', {
            count: spikeTurns.length,
            plural: spikeTurns.length === 1 ? '' : 's',
            max: (maxSpike / 1000).toFixed(0),
            avg: (avgTokens / 1000).toFixed(0),
          })}\x1b[0m`
        )
      }

      // Show if cache was degraded
      if (s.cacheHealth.status === 'degraded' || s.cacheHealth.status === 'broken') {
        console.log(
          `  \x1b[33m${t('sessions.cacheIssue', { status: s.cacheHealth.status })}\x1b[0m`
        )
      }
    }

    console.log('')
  })

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return t('sessions.justNow')
  if (seconds < 3600) return t('sessions.minAgo', { n: Math.floor(seconds / 60) })
  if (seconds < 86400) return t('sessions.hourAgo', { n: Math.floor(seconds / 3600) })
  return t('sessions.dayAgo', { n: Math.floor(seconds / 86400) })
}

// ─── clauditor knowledge ─────────────────────────────────────────

program
  .command('knowledge')
  .description(t('cli.cmd.knowledge.desc'))
  .option('-p, --project <path>', t('cli.cmd.knowledge.opt.project'), process.cwd())
  .option('--json', t('cli.cmd.status.opt.json'))
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
    console.log(t('knowledge.header', { cwd }))
    console.log('  ' + '─'.repeat(58))

    // Errors
    if (errors.length > 0) {
      console.log('')
      console.log(`  \x1b[31m${t('knowledge.errorsLabel', { count: errors.length }).trim()}\x1b[0m`)
      for (const e of errors.slice(0, 10)) {
        console.log(t('knowledge.errorItem', { command: e.command.slice(0, 50), count: e.occurrences }))
        console.log(t('knowledge.errorMsg', { msg: e.error.slice(0, 80) }))
        if (e.fix) console.log(`    \x1b[32m${t('knowledge.errorFix', { fix: e.fix.slice(0, 80) }).trim()}\x1b[0m`)
      }
    } else {
      console.log('')
      console.log(t('knowledge.noErrors'))
    }

    // Files
    const hotFiles = Object.entries(files)
      .filter(([, f]) => f.editCount >= 3)
      .sort(([, a], [, b]) => b.editCount - a.editCount)

    if (hotFiles.length > 0) {
      console.log('')
      console.log(`  \x1b[33m${t('knowledge.filesLabel').trim()}\x1b[0m`)
      for (const [name, f] of hotFiles.slice(0, 15)) {
        console.log(`  ${name.padEnd(40)} ${String(f.editCount).padStart(3)} edits  ${String(f.sessions).padStart(2)} sessions  last: ${f.lastEdited}`)
      }
    } else {
      console.log('')
      console.log(t('knowledge.noFiles'))
    }

    console.log('')
    console.log(t('knowledge.footer'))
    console.log('')
  })

// ─── clauditor suggest-skill ─────────────────────────────────────

program
  .command('suggest-skill')
  .description(t('cli.cmd.suggestSkill.desc'))
  .option('-p, --project <path>', t('cli.cmd.suggestSkill.opt.project'))
  .option('--json', t('cli.cmd.status.opt.json'))
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

    if (!options.json) console.log(t('common.scanningHeader'))
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

    console.log(t('suggestSkill.header'))
    console.log('─'.repeat(55))

    if (suggestions.length === 0) {
      console.log(t('suggestSkill.none'))
      console.log(t('suggestSkill.noneHint'))
    } else {
      console.log(formatSkillSuggestions(suggestions))
      console.log(t('suggestSkill.enableAuto'))
      console.log(t('suggestSkill.enableAutoHint'))
    }
    console.log('')
  })

// ─── clauditor hook <name> ───────────────────────────────────────

const hookCmd = program
  .command('hook')
  .description(t('cli.cmd.hook.desc'))

hookCmd
  .command('stop')
  .description(t('cli.cmd.hook.stop.desc'))
  .action(async () => {
    await import('./hooks/stop.js')
  })

hookCmd
  .command('post-tool-use')
  .description(t('cli.cmd.hook.postToolUse.desc'))
  .action(async () => {
    await import('./hooks/post-tool-use.js')
  })

hookCmd
  .command('pre-tool-use')
  .description(t('cli.cmd.hook.preToolUse.desc'))
  .action(async () => {
    await import('./hooks/pre-tool-use.js')
  })

hookCmd
  .command('user-prompt-submit')
  .description(t('cli.cmd.hook.userPromptSubmit.desc'))
  .action(async () => {
    await import('./hooks/user-prompt-submit.js')
  })

hookCmd
  .command('pre-compact')
  .description(t('cli.cmd.hook.preCompact.desc'))
  .action(async () => {
    await import('./hooks/pre-compact.js')
  })

hookCmd
  .command('post-compact')
  .description(t('cli.cmd.hook.postCompact.desc'))
  .action(async () => {
    await import('./hooks/post-compact.js')
  })

hookCmd
  .command('session-start')
  .description(t('cli.cmd.hook.sessionStart.desc'))
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
        console.error(t('update.header', { current: pkg.version, latest }))
        console.error(t('update.hint', { cmd }))
      })
    }
  } catch {}
}

// ─── clauditor handoff-report ────────────────────────────────────

program
  .command('handoff-report')
  .description(t('cli.cmd.handoffReport.desc'))
  .option('-t, --transcript <path>', t('cli.cmd.handoffReport.opt.transcript'))
  .option('-s, --summary <path>', t('cli.cmd.handoffReport.opt.summary'))
  .option('--json', t('cli.cmd.status.opt.json'))
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
      console.error(t('handoffReport.errNoTranscript'))
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
        console.error(t('handoffReport.errNoHandoff'))
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
      console.log(t('handoffReport.noFacts'))
      return
    }

    const score = scoreHandoff(facts, summaryContent)

    if (options.json) {
      console.log(JSON.stringify({ ...score, transcriptPath, project: transcriptCwd }, null, 2))
    } else {
      if (transcriptCwd) {
        const projectName = transcriptCwd.split('/').pop() || transcriptCwd
        console.log(t('handoffReport.project', { name: projectName }))
      }
      console.log(generateReport(score))
    }
  })

// Default command: if no subcommand given, run `report`
if (process.argv.length <= 2) {
  process.argv.push('report')
}

program.parse()
