// Core JSONL record types — derived from publicly observable Claude Code session file structure

export interface BaseRecord {
  type: string
  uuid?: string
  parentUuid?: string | null
  sessionId: string
  timestamp: string
  isSidechain?: boolean
}

export interface UserRecord extends BaseRecord {
  type: 'user'
  message: { role: 'user'; content: string | unknown[] }
  cwd?: string
  gitBranch?: string
  version?: string
}

export interface AssistantRecord extends BaseRecord {
  type: 'assistant'
  message: {
    role: 'assistant'
    model: string
    content: ContentBlock[]
    usage?: TokenUsage
  }
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'thinking'
  text?: string
  id?: string
  name?: string
  input?: unknown
}

export interface ToolResultRecord extends BaseRecord {
  type: 'tool_result'
  toolUseId: string
  content: string
  durationMs?: number
}

export interface SummaryRecord {
  type: 'summary'
  leafUuid: string
  summary: string
}

export interface CompactBoundaryRecord {
  type: 'compact_boundary'
}

// Generic record for types we don't need to inspect deeply
export interface GenericRecord {
  type: string
  sessionId?: string
  timestamp?: string
  [key: string]: unknown
}

export type SessionRecord =
  | UserRecord
  | AssistantRecord
  | ToolResultRecord
  | SummaryRecord
  | CompactBoundaryRecord
  | GenericRecord

// Computed per-session state

export interface SessionState {
  sessionId: string
  projectPath: string
  filePath: string
  model: string | null
  label: string
  cwd: string | null
  gitBranch: string | null
  turns: TurnMetrics[]
  totalUsage: TokenUsage
  cacheHealth: CacheHealth
  loopState: LoopState
  resumeAnomaly: ResumeAnomaly
  quotaBurnRate: QuotaBurnRate
  lastUpdated: Date
}

export interface TurnMetrics {
  turnIndex: number
  timestamp: string
  usage: TokenUsage
  cacheRatio: number
  toolCalls: ToolCallSummary[]
}

export interface ToolCallSummary {
  name: string
  inputHash: string
  outputHash: string
  /** Short readable label — e.g. "npm test" for Bash commands */
  inputLabel?: string
}

export interface CacheHealth {
  status: 'healthy' | 'degraded' | 'broken' | 'unknown'
  lastCacheRatio: number
  cacheRatioTrend: number[]
  degradationDetected: boolean
}

export interface LoopState {
  loopDetected: boolean
  consecutiveIdenticalTurns: number
  loopPattern?: string
}

export interface ResumeAnomaly {
  detected: boolean
  resumeDetected: boolean
  outputTokenSpike: number | null
  cacheInvalidatedAfterResume: boolean
}

export interface QuotaBurnRate {
  tokensPerMinute: number
  estimatedMinutesRemaining: number | null
  burnRateStatus: 'normal' | 'elevated' | 'critical'
}

// Configuration

export interface ClauditorConfig {
  pricing: PricingConfig
  alerts: AlertConfig
  bashFilter: BashFilterConfig
  watch: WatchConfig
  rotation: RotationConfig
}

export interface PricingConfig {
  model: string
  inputPerMillion: number
  outputPerMillion: number
  cacheCreationPerMillion: number
  cacheReadPerMillion: number
}

export interface AlertConfig {
  cacheBugThreshold: number
  loopDetectionThreshold: number
  claudeMdTokenWarning: number
  desktopNotifications: boolean
}

export interface BashFilterConfig {
  enabled: boolean
  maxOutputChars: number
  preservePatterns: string[]
  noisePatterns: string[]
}

export interface WatchConfig {
  projectsDir: string
  pollInterval: number
}

export interface RotationConfig {
  enabled: boolean
  writeToClaudeMd: boolean
  tokensPerTurnThreshold: number
  minTurns: number
}

// Hook I/O types

export interface StopHookInput {
  session_id: string
  transcript_path: string
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message: string
}

export interface PostToolUseHookInput {
  session_id: string
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  tool_response: string
  cwd?: string
}

export interface PreToolUseHookInput {
  session_id: string
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: Record<string, unknown>
  cwd?: string
}

export interface HookDecision {
  decision?: 'block' | 'approve'
  reason?: string
  additionalContext?: string
}

// Model pricing table
// NOTE: Canonical pricing now lives in src/providers/claude/pricing.ts.
// This re-export preserves backward compatibility for existing imports.

import { CLAUDE_MODELS } from './providers/claude/pricing.js'
export { CLAUDE_MODELS as MODEL_PRICING } from './providers/claude/pricing.js'

export const DEFAULT_CONFIG: ClauditorConfig = {
  pricing: CLAUDE_MODELS['claude-sonnet-4-6'],
  alerts: {
    cacheBugThreshold: 3,
    loopDetectionThreshold: 3,
    claudeMdTokenWarning: 4000,
    desktopNotifications: true,
  },
  bashFilter: {
    enabled: true,
    maxOutputChars: 2000,
    preservePatterns: ['error', 'warn', 'fail', 'exception'],
    noisePatterns: ['npm warn', 'added \\d+ packages', '\\[=+'],
  },
  watch: {
    projectsDir: '~/.claude/projects',
    pollInterval: 1000,
  },
  rotation: {
    enabled: true,
    writeToClaudeMd: true,
    tokensPerTurnThreshold: 100_000,
    minTurns: 30,
  },
}
