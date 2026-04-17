/**
 * Provider abstraction layer — enables clauditor to work with any AI coding tool.
 *
 * Each provider (Claude Code, Codex, Cursor, Windsurf, Cline, etc.) implements
 * these interfaces to plug into clauditor's features (cache health, loop detection,
 * error index, handoffs, cost tracking, hub sync).
 */

import type {
  SessionRecord,
  TurnMetrics,
  TokenUsage,
  PricingConfig,
  HookDecision,
} from '../types.js'

// ---------------------------------------------------------------------------
// Canonical tool names — features operate on these, never provider-specific names
// ---------------------------------------------------------------------------

export type CanonicalTool =
  | 'bash_execute'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'file_search'
  | 'web_search'
  | 'web_fetch'
  | 'browser'
  | 'mcp_tool'
  | 'other'

// ---------------------------------------------------------------------------
// Canonical hook events — mapped to/from provider-specific event names
// ---------------------------------------------------------------------------

export type CanonicalHookEvent =
  | 'session_start'
  | 'user_prompt_submit'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'pre_compact'
  | 'post_compact'
  | 'stop'

// ---------------------------------------------------------------------------
// Provider capability tiers
// ---------------------------------------------------------------------------

export type ProviderTier = 1 | 2 | 3
// Tier 1: Full hooks + session monitoring (Claude, Codex, Cursor, Windsurf, Cline)
// Tier 2: Session monitoring only, no hooks (Gemini CLI, Aider)
// Tier 3: Limited monitoring (Copilot, Zed, Amazon Q)

// ---------------------------------------------------------------------------
// Core provider interface
// ---------------------------------------------------------------------------

export interface Provider {
  /** Short identifier: 'claude', 'codex', 'cursor', etc. */
  name: string
  /** Human-readable: 'Claude Code', 'Codex CLI', etc. */
  displayName: string
  /** Capability tier */
  tier: ProviderTier

  /** Directory resolution */
  directories: DirectoryResolver
  /** Session parsing — provider format → canonical TurnMetrics */
  parser: SessionParser
  /** Session file discovery and identification */
  discovery: SessionDiscovery
  /** Model pricing */
  pricing: PricingResolver
  /** Tool name mapping */
  tools: ToolNameMapper

  /** Hook system (null for Tier 2/3 providers without hooks) */
  hooks: HookManager | null

  /** Context window limit for a given model */
  getContextLimit(model: string): number
}

// ---------------------------------------------------------------------------
// Directory resolution
// ---------------------------------------------------------------------------

export interface DirectoryResolver {
  /** Where the provider stores session data (e.g. ~/.claude/projects) */
  sessionsDir(): string
  /** Provider config directory (e.g. ~/.claude) */
  configDir(): string
  /** Clauditor shared state directory — always ~/.clauditor */
  stateDir(): string
}

// ---------------------------------------------------------------------------
// Session parsing
// ---------------------------------------------------------------------------

export interface SessionContext {
  cwd: string | null
  gitBranch: string | null
  projectName: string | null
  firstUserMessage: string | null
}

export interface SessionParser {
  /** Parse a single line/record from the provider's session format */
  parseLine(line: string): SessionRecord | null
  /** Parse an entire session file into records */
  parseFile(filePath: string): Promise<SessionRecord[]>
  /** Extract turn metrics from parsed records */
  extractTurns(records: SessionRecord[]): TurnMetrics[]
  /** Extract model ID from records */
  extractModel(records: SessionRecord[]): string | null
  /** Extract session context (cwd, git branch, etc.) */
  extractContext(records: SessionRecord[]): SessionContext
  /** Check for resume/compaction boundaries */
  hasResumeBoundary(records: SessionRecord[]): boolean
}

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

export interface SessionDiscovery {
  /** File extensions to watch (e.g. ['.jsonl'], ['.json']) */
  fileExtensions: string[]
  /** Glob depth for directory watching */
  watchDepth: number
  /** Extract session ID from a file path */
  extractSessionId(filePath: string): string
  /** Extract project identifier from a file path */
  extractProjectPath(filePath: string, baseDir: string): string
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface PricingResolver {
  /** All known models for this provider */
  models: Record<string, PricingConfig>
  /** Get pricing for a model ID (supports prefix matching) */
  getPricing(modelId: string): PricingConfig
  /** Default model pricing (fallback) */
  defaultPricing: PricingConfig
}

// ---------------------------------------------------------------------------
// Tool name mapping
// ---------------------------------------------------------------------------

export interface ToolNameMapper {
  /** Map provider-specific tool name to canonical name */
  toCanonical(providerToolName: string): CanonicalTool
  /** Map canonical name back to provider's primary tool name */
  fromCanonical(canonical: CanonicalTool): string
  /** Extract a short readable label from tool input (e.g. "npm test" for bash) */
  extractInputLabel(toolName: string, input: unknown): string
}

// ---------------------------------------------------------------------------
// Hook management
// ---------------------------------------------------------------------------

export interface HookManager {
  /** Hook event names this provider supports */
  supportedEvents: CanonicalHookEvent[]
  /** Exit code for blocking actions */
  blockExitCode: number

  /** Map canonical event to provider-specific event name (null if unsupported) */
  eventName(canonical: CanonicalHookEvent): string | null

  /** Install clauditor hooks into the provider's config */
  install(): Promise<string[]>
  /** Uninstall clauditor hooks from the provider's config */
  uninstall(): Promise<string[]>

  /** Format a HookDecision into the provider's expected output format */
  formatOutput(decision: HookDecision): string
}
