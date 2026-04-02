import type { SessionState, TokenUsage, TurnMetrics } from '../types.js'
import { detectCacheDegradation } from '../features/cache-health.js'
import { detectLoop } from '../features/loop-detector.js'
import { detectResumeAnomaly } from '../features/resume-detector.js'
import { estimateQuotaBurnRate } from '../features/quota-burn.js'

export class SessionStore {
  // Keyed by filePath (not sessionId) because subagent IDs like
  // "agent-a2" repeat across different parent sessions.
  private sessions = new Map<string, SessionState>()
  private listeners = new Set<(sessionId: string, state: SessionState) => void>()

  get(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId)
  }

  getAll(): SessionState[] {
    return Array.from(this.sessions.values())
  }

  getByProject(projectPath: string): SessionState[] {
    return this.getAll().filter((s) => s.projectPath === projectPath)
  }

  /**
   * Update a session with new turn data. Recomputes derived state
   * (cache health, loop detection, resume anomaly, burn rate) on each update.
   */
  update(
    sessionId: string,
    filePath: string,
    projectPath: string,
    turns: TurnMetrics[],
    model: string | null = null,
    context: { cwd: string | null; gitBranch: string | null; projectName: string | null; firstUserMessage: string | null } = { cwd: null, gitBranch: null, projectName: null, firstUserMessage: null },
    isResumed: boolean = false
  ): SessionState {
    const totalUsage = this.aggregateUsage(turns)
    const cacheHealth = detectCacheDegradation(turns)
    const loopState = detectLoop(turns)
    const resumeAnomaly = detectResumeAnomaly(turns, isResumed)
    const quotaBurnRate = estimateQuotaBurnRate(turns)

    // Use the last turn's timestamp as lastUpdated, not scan time
    const lastTurnTimestamp = turns[turns.length - 1]?.timestamp
    const lastUpdated = lastTurnTimestamp
      ? new Date(lastTurnTimestamp)
      : new Date()

    // Build a human-readable label
    const isSubagent = sessionId.startsWith('agent-')
    const name = context.projectName || projectPath
    const branch = context.gitBranch ? ` (${context.gitBranch})` : ''
    let label: string
    if (isSubagent && context.firstUserMessage) {
      const shortId = sessionId.slice(6, 8)
      const task = context.firstUserMessage.slice(0, 35).replace(/\n/g, ' ')
      label = `↳ (${shortId}) ${task}${context.firstUserMessage.length > 35 ? '…' : ''}`
    } else if (isSubagent) {
      label = `↳ (${sessionId.slice(6, 8)}) subagent`
    } else {
      label = `${name}${branch}`
    }

    const state: SessionState = {
      sessionId,
      filePath,
      projectPath,
      model,
      label,
      cwd: context.cwd,
      gitBranch: context.gitBranch,
      turns,
      totalUsage,
      cacheHealth,
      loopState,
      resumeAnomaly,
      quotaBurnRate,
      lastUpdated,
    }

    this.sessions.set(filePath, state)
    this.notifyListeners(sessionId, state)
    return state
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  onUpdate(listener: (sessionId: string, state: SessionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(sessionId: string, state: SessionState): void {
    for (const listener of this.listeners) {
      listener(sessionId, state)
    }
  }

  private aggregateUsage(turns: TurnMetrics[]): TokenUsage {
    return turns.reduce(
      (acc, turn) => ({
        input_tokens: acc.input_tokens + turn.usage.input_tokens,
        output_tokens: acc.output_tokens + turn.usage.output_tokens,
        cache_creation_input_tokens:
          acc.cache_creation_input_tokens + turn.usage.cache_creation_input_tokens,
        cache_read_input_tokens:
          acc.cache_read_input_tokens + turn.usage.cache_read_input_tokens,
      }),
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
    )
  }
}
