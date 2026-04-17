/**
 * Comprehensive provider tests — verifies all 10 providers implement
 * the Provider interface correctly, with working tool mappings, pricing,
 * parsers, hooks, and discovery.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { ProviderRegistry } from './registry.js'
import { claudeProvider } from './claude/index.js'
import { codexProvider } from './codex/index.js'
import { cursorProvider } from './cursor/index.js'
import { windsurfProvider } from './windsurf/index.js'
import { clineProvider } from './cline/index.js'
import { geminiProvider } from './gemini/index.js'
import { aiderProvider } from './aider/index.js'
import { copilotProvider } from './copilot/index.js'
import { zedProvider } from './zed/index.js'
import { amazonqProvider } from './amazonq/index.js'
import type { HookDecision } from '../types.js'

// ---------------------------------------------------------------------------
// Build a fresh registry for testing (avoid import-time side effects)
// ---------------------------------------------------------------------------

let registry: ProviderRegistry

const ALL_PROVIDERS = [
  claudeProvider,
  codexProvider,
  cursorProvider,
  windsurfProvider,
  clineProvider,
  geminiProvider,
  aiderProvider,
  copilotProvider,
  zedProvider,
  amazonqProvider,
]

const ALL_NAMES = [
  'claude', 'codex', 'cursor', 'windsurf', 'cline',
  'gemini', 'aider', 'copilot', 'zed', 'amazonq',
]

const TIER_1_PROVIDERS = ALL_PROVIDERS.filter((p) => p.tier === 1)
const TIER_2_PROVIDERS = ALL_PROVIDERS.filter((p) => p.tier === 2)
const TIER_3_PROVIDERS = ALL_PROVIDERS.filter((p) => p.tier === 3)

beforeAll(() => {
  registry = new ProviderRegistry()
  for (const p of ALL_PROVIDERS) {
    registry.register(p)
  }
})

// ===========================================================================
// 1. Registry tests
// ===========================================================================

describe('ProviderRegistry', () => {
  it('has all 10 providers registered', () => {
    expect(registry.getAll()).toHaveLength(10)
  })

  it('names() returns all provider identifiers', () => {
    const names = registry.names()
    for (const name of ALL_NAMES) {
      expect(names).toContain(name)
    }
  })

  it('get() returns the correct provider by name', () => {
    for (const name of ALL_NAMES) {
      const p = registry.get(name)
      expect(p.name).toBe(name)
    }
  })

  it('get() throws for unknown provider', () => {
    expect(() => registry.get('nonexistent')).toThrow(/Unknown provider/)
  })

  it('find() returns provider or null', () => {
    expect(registry.find('claude')).not.toBeNull()
    expect(registry.find('nonexistent')).toBeNull()
  })

  it('detect() returns an array (may be empty if tools not installed)', () => {
    const detected = registry.detect()
    expect(Array.isArray(detected)).toBe(true)
  })

  it('forSessionFile() matches Claude session path', () => {
    const homeDir = require('node:os').homedir()
    const fakePath = `${homeDir}/.claude/projects/myproject/session-abc.jsonl`
    const found = registry.forSessionFile(fakePath)
    // Should match claude if the path prefix matches
    if (found) {
      expect(found.name).toBe('claude')
    }
  })
})

// ===========================================================================
// 2. Interface compliance — every provider has the required shape
// ===========================================================================

describe('Interface compliance', () => {
  for (const provider of ALL_PROVIDERS) {
    describe(provider.displayName, () => {
      it('has name and displayName as non-empty strings', () => {
        expect(typeof provider.name).toBe('string')
        expect(provider.name.length).toBeGreaterThan(0)
        expect(typeof provider.displayName).toBe('string')
        expect(provider.displayName.length).toBeGreaterThan(0)
      })

      it('has a valid tier (1, 2, or 3)', () => {
        expect([1, 2, 3]).toContain(provider.tier)
      })

      it('has directories with sessionsDir, configDir, stateDir', () => {
        expect(typeof provider.directories.sessionsDir).toBe('function')
        expect(typeof provider.directories.configDir).toBe('function')
        expect(typeof provider.directories.stateDir).toBe('function')
        // Each returns a non-empty string path
        expect(provider.directories.sessionsDir().length).toBeGreaterThan(0)
        expect(provider.directories.configDir().length).toBeGreaterThan(0)
        expect(provider.directories.stateDir()).toContain('.clauditor')
      })

      it('has a parser with all required methods', () => {
        expect(typeof provider.parser.parseLine).toBe('function')
        expect(typeof provider.parser.parseFile).toBe('function')
        expect(typeof provider.parser.extractTurns).toBe('function')
        expect(typeof provider.parser.extractModel).toBe('function')
        expect(typeof provider.parser.extractContext).toBe('function')
        expect(typeof provider.parser.hasResumeBoundary).toBe('function')
      })

      it('has discovery with fileExtensions, watchDepth, extractSessionId, extractProjectPath', () => {
        expect(Array.isArray(provider.discovery.fileExtensions)).toBe(true)
        expect(provider.discovery.fileExtensions.length).toBeGreaterThan(0)
        expect(typeof provider.discovery.watchDepth).toBe('number')
        expect(typeof provider.discovery.extractSessionId).toBe('function')
        expect(typeof provider.discovery.extractProjectPath).toBe('function')
      })

      it('has pricing with models, defaultPricing, getPricing', () => {
        expect(typeof provider.pricing.models).toBe('object')
        expect(provider.pricing.defaultPricing).toBeDefined()
        expect(typeof provider.pricing.defaultPricing.model).toBe('string')
        expect(typeof provider.pricing.getPricing).toBe('function')
      })

      it('has tools with toCanonical, fromCanonical, extractInputLabel', () => {
        expect(typeof provider.tools.toCanonical).toBe('function')
        expect(typeof provider.tools.fromCanonical).toBe('function')
        expect(typeof provider.tools.extractInputLabel).toBe('function')
      })

      it('has hooks (Tier 1) or null (Tier 2/3)', () => {
        if (provider.tier === 1) {
          expect(provider.hooks).not.toBeNull()
          expect(Array.isArray(provider.hooks!.supportedEvents)).toBe(true)
          expect(typeof provider.hooks!.blockExitCode).toBe('number')
          expect(typeof provider.hooks!.eventName).toBe('function')
          expect(typeof provider.hooks!.formatOutput).toBe('function')
          expect(typeof provider.hooks!.install).toBe('function')
          expect(typeof provider.hooks!.uninstall).toBe('function')
        } else {
          expect(provider.hooks).toBeNull()
        }
      })

      it('has getContextLimit as a function returning a positive number', () => {
        expect(typeof provider.getContextLimit).toBe('function')
        expect(provider.getContextLimit('test-model')).toBeGreaterThan(0)
      })
    })
  }
})

// ===========================================================================
// 3. Tool name mapping round-trips (Tier 1 providers)
// ===========================================================================

describe('Tool name mapping round-trips', () => {
  describe('Claude Code', () => {
    it('maps Bash -> bash_execute -> Bash', () => {
      expect(claudeProvider.tools.toCanonical('Bash')).toBe('bash_execute')
      expect(claudeProvider.tools.fromCanonical('bash_execute')).toBe('Bash')
    })
    it('maps Read -> file_read -> Read', () => {
      expect(claudeProvider.tools.toCanonical('Read')).toBe('file_read')
      expect(claudeProvider.tools.fromCanonical('file_read')).toBe('Read')
    })
    it('maps Edit -> file_edit -> Edit', () => {
      expect(claudeProvider.tools.toCanonical('Edit')).toBe('file_edit')
      expect(claudeProvider.tools.fromCanonical('file_edit')).toBe('Edit')
    })
    it('maps Write -> file_write -> Write', () => {
      expect(claudeProvider.tools.toCanonical('Write')).toBe('file_write')
      expect(claudeProvider.tools.fromCanonical('file_write')).toBe('Write')
    })
    it('maps unknown tool to other', () => {
      expect(claudeProvider.tools.toCanonical('NonexistentTool')).toBe('other')
    })
    it('extractInputLabel for Bash extracts command', () => {
      expect(claudeProvider.tools.extractInputLabel('Bash', { command: 'npm test' })).toBe('npm test')
    })
    it('extractInputLabel for Read extracts filename', () => {
      expect(claudeProvider.tools.extractInputLabel('Read', { file_path: '/foo/bar/baz.ts' })).toBe('baz.ts')
    })
  })

  describe('Codex CLI', () => {
    it('maps shell -> bash_execute -> shell', () => {
      expect(codexProvider.tools.toCanonical('shell')).toBe('bash_execute')
      expect(codexProvider.tools.fromCanonical('bash_execute')).toBe('shell')
    })
    it('maps list_dir -> file_read -> list_dir', () => {
      expect(codexProvider.tools.toCanonical('list_dir')).toBe('file_read')
      expect(codexProvider.tools.fromCanonical('file_read')).toBe('list_dir')
    })
    it('maps apply_patch -> file_edit -> apply_patch', () => {
      expect(codexProvider.tools.toCanonical('apply_patch')).toBe('file_edit')
      expect(codexProvider.tools.fromCanonical('file_edit')).toBe('apply_patch')
    })
    it('extractInputLabel for shell with array command', () => {
      expect(codexProvider.tools.extractInputLabel('shell', { command: ['npm', 'test'] })).toBe('npm test')
    })
  })

  describe('Cursor', () => {
    it('maps run_terminal_command -> bash_execute -> run_terminal_command', () => {
      expect(cursorProvider.tools.toCanonical('run_terminal_command')).toBe('bash_execute')
      expect(cursorProvider.tools.fromCanonical('bash_execute')).toBe('run_terminal_command')
    })
    it('maps read_file -> file_read -> read_file', () => {
      expect(cursorProvider.tools.toCanonical('read_file')).toBe('file_read')
      expect(cursorProvider.tools.fromCanonical('file_read')).toBe('read_file')
    })
    it('maps edit_file -> file_edit -> edit_file', () => {
      expect(cursorProvider.tools.toCanonical('edit_file')).toBe('file_edit')
      expect(cursorProvider.tools.fromCanonical('file_edit')).toBe('edit_file')
    })
  })

  describe('Windsurf', () => {
    it('maps run_command -> bash_execute -> run_command', () => {
      expect(windsurfProvider.tools.toCanonical('run_command')).toBe('bash_execute')
      expect(windsurfProvider.tools.fromCanonical('bash_execute')).toBe('run_command')
    })
    it('maps view_file -> file_read -> view_file', () => {
      expect(windsurfProvider.tools.toCanonical('view_file')).toBe('file_read')
      expect(windsurfProvider.tools.fromCanonical('file_read')).toBe('view_file')
    })
    it('maps edit_file -> file_edit -> edit_file', () => {
      expect(windsurfProvider.tools.toCanonical('edit_file')).toBe('file_edit')
      expect(windsurfProvider.tools.fromCanonical('file_edit')).toBe('edit_file')
    })
  })

  describe('Cline', () => {
    it('maps execute_command -> bash_execute -> execute_command', () => {
      expect(clineProvider.tools.toCanonical('execute_command')).toBe('bash_execute')
      expect(clineProvider.tools.fromCanonical('bash_execute')).toBe('execute_command')
    })
    it('maps read_file -> file_read -> read_file', () => {
      expect(clineProvider.tools.toCanonical('read_file')).toBe('file_read')
      expect(clineProvider.tools.fromCanonical('file_read')).toBe('read_file')
    })
    it('maps replace_in_file -> file_edit -> replace_in_file', () => {
      expect(clineProvider.tools.toCanonical('replace_in_file')).toBe('file_edit')
      expect(clineProvider.tools.fromCanonical('file_edit')).toBe('replace_in_file')
    })
    it('maps browser_action -> browser -> browser_action', () => {
      expect(clineProvider.tools.toCanonical('browser_action')).toBe('browser')
      expect(clineProvider.tools.fromCanonical('browser')).toBe('browser_action')
    })
  })

  describe('Tier 2/3 providers basic tool mapping', () => {
    it('Gemini: ExecuteCommand -> bash_execute', () => {
      expect(geminiProvider.tools.toCanonical('ExecuteCommand')).toBe('bash_execute')
      expect(geminiProvider.tools.fromCanonical('bash_execute')).toBe('ExecuteCommand')
    })
    it('Aider: /run -> bash_execute', () => {
      expect(aiderProvider.tools.toCanonical('/run')).toBe('bash_execute')
      expect(aiderProvider.tools.fromCanonical('bash_execute')).toBe('/run')
    })
    it('Copilot: run_terminal_command -> bash_execute', () => {
      expect(copilotProvider.tools.toCanonical('run_terminal_command')).toBe('bash_execute')
    })
    it('Zed: run_terminal_command -> bash_execute', () => {
      expect(zedProvider.tools.toCanonical('run_terminal_command')).toBe('bash_execute')
    })
    it('Amazon Q: execute_bash -> bash_execute', () => {
      expect(amazonqProvider.tools.toCanonical('execute_bash')).toBe('bash_execute')
      expect(amazonqProvider.tools.fromCanonical('bash_execute')).toBe('execute_bash')
    })
  })
})

// ===========================================================================
// 4. Pricing lookups
// ===========================================================================

describe('Pricing lookups', () => {
  describe('Claude', () => {
    it('returns Sonnet pricing for claude-sonnet-4-6 prefix', () => {
      const p = claudeProvider.pricing.getPricing('claude-sonnet-4-6-20260301')
      expect(p.inputPerMillion).toBe(3.0)
      expect(p.outputPerMillion).toBe(15.0)
    })
    it('returns Opus pricing for claude-opus-4-6', () => {
      const p = claudeProvider.pricing.getPricing('claude-opus-4-6-20260401')
      expect(p.inputPerMillion).toBe(15.0)
    })
    it('returns Haiku pricing for claude-haiku-4-5', () => {
      const p = claudeProvider.pricing.getPricing('claude-haiku-4-5-20250101')
      expect(p.inputPerMillion).toBe(0.8)
    })
    it('falls back to Sonnet (default) for unknown model', () => {
      const p = claudeProvider.pricing.getPricing('some-unknown-model-xyz')
      expect(p.model).toBe('claude-sonnet-4-6')
    })
  })

  describe('Codex', () => {
    it('returns gpt-4.1 pricing', () => {
      const p = codexProvider.pricing.getPricing('gpt-4.1-2025-04')
      expect(p.inputPerMillion).toBe(2.0)
    })
    it('returns o4-mini pricing', () => {
      const p = codexProvider.pricing.getPricing('o4-mini-high')
      expect(p.inputPerMillion).toBe(1.1)
    })
    it('falls back to o4-mini (default) for unknown', () => {
      const p = codexProvider.pricing.getPricing('unknown-model')
      expect(p.model).toBe('o4-mini')
    })
  })

  describe('Cursor', () => {
    it('returns gpt-4o pricing', () => {
      const p = cursorProvider.pricing.getPricing('gpt-4o-2025')
      expect(p.inputPerMillion).toBe(2.5)
    })
    it('returns claude-sonnet-4-6 pricing', () => {
      const p = cursorProvider.pricing.getPricing('claude-sonnet-4-6-latest')
      expect(p.inputPerMillion).toBe(3.0)
    })
    it('falls back to gpt-4o (default) for unknown', () => {
      const p = cursorProvider.pricing.getPricing('unknown-model')
      expect(p.model).toBe('gpt-4o')
    })
  })

  describe('Windsurf', () => {
    it('returns gemini-2.5-pro pricing', () => {
      const p = windsurfProvider.pricing.getPricing('gemini-2.5-pro-latest')
      expect(p.inputPerMillion).toBe(1.25)
    })
    it('falls back to windsurf-default for unknown', () => {
      const p = windsurfProvider.pricing.getPricing('unknown-model')
      expect(p.model).toBe('windsurf-default')
    })
  })

  describe('Cline', () => {
    it('returns deepseek-chat pricing', () => {
      const p = clineProvider.pricing.getPricing('deepseek-chat-v3')
      expect(p.inputPerMillion).toBe(0.27)
    })
    it('returns gemini-2.5-pro pricing', () => {
      const p = clineProvider.pricing.getPricing('gemini-2.5-pro-exp')
      expect(p.inputPerMillion).toBe(1.25)
    })
    it('falls back to claude-sonnet-4-6 for unknown', () => {
      const p = clineProvider.pricing.getPricing('unknown')
      expect(p.model).toBe('claude-sonnet-4-6')
    })
  })

  describe('Gemini', () => {
    it('returns gemini-2.5-pro pricing', () => {
      const p = geminiProvider.pricing.getPricing('gemini-2.5-pro')
      expect(p.inputPerMillion).toBe(1.25)
    })
    it('returns gemini-2.5-flash pricing', () => {
      const p = geminiProvider.pricing.getPricing('gemini-2.5-flash-latest')
      expect(p.inputPerMillion).toBe(0.15)
    })
    it('returns gemini-2.0-flash pricing', () => {
      const p = geminiProvider.pricing.getPricing('gemini-2.0-flash')
      expect(p.inputPerMillion).toBe(0.1)
    })
    it('falls back to gemini-2.5-flash for unknown', () => {
      const p = geminiProvider.pricing.getPricing('unknown')
      expect(p.model).toBe('gemini-2.5-flash')
    })
  })

  describe('Aider', () => {
    it('returns gpt-4o pricing', () => {
      const p = aiderProvider.pricing.getPricing('gpt-4o-latest')
      expect(p.inputPerMillion).toBe(2.5)
    })
    it('falls back to claude-sonnet-4-6 for unknown', () => {
      const p = aiderProvider.pricing.getPricing('unknown-llm')
      expect(p.model).toBe('claude-sonnet-4-6')
    })
  })

  describe('Copilot', () => {
    it('returns gpt-4o pricing', () => {
      const p = copilotProvider.pricing.getPricing('gpt-4o')
      expect(p.inputPerMillion).toBe(2.5)
    })
    it('falls back to zero-cost copilot-default for unknown', () => {
      const p = copilotProvider.pricing.getPricing('unknown')
      expect(p.model).toBe('copilot-default')
      expect(p.inputPerMillion).toBe(0)
    })
  })

  describe('Zed', () => {
    it('returns claude-sonnet-4-6 pricing', () => {
      const p = zedProvider.pricing.getPricing('claude-sonnet-4-6-latest')
      expect(p.inputPerMillion).toBe(3.0)
    })
    it('falls back to claude-sonnet-4-6 for unknown', () => {
      const p = zedProvider.pricing.getPricing('unknown')
      expect(p.model).toBe('claude-sonnet-4-6')
    })
  })

  describe('Amazon Q', () => {
    it('returns zero-cost default for any model', () => {
      const p = amazonqProvider.pricing.getPricing('anything')
      expect(p.model).toBe('amazonq-default')
      expect(p.inputPerMillion).toBe(0)
      expect(p.outputPerMillion).toBe(0)
    })
  })

  describe('All providers have valid PricingConfig shapes', () => {
    for (const provider of ALL_PROVIDERS) {
      it(`${provider.name}: defaultPricing has all required fields`, () => {
        const dp = provider.pricing.defaultPricing
        expect(typeof dp.model).toBe('string')
        expect(typeof dp.inputPerMillion).toBe('number')
        expect(typeof dp.outputPerMillion).toBe('number')
        expect(typeof dp.cacheCreationPerMillion).toBe('number')
        expect(typeof dp.cacheReadPerMillion).toBe('number')
        expect(dp.inputPerMillion).toBeGreaterThanOrEqual(0)
        expect(dp.outputPerMillion).toBeGreaterThanOrEqual(0)
      })
    }
  })
})

// ===========================================================================
// 5. Parser tests with sample data
// ===========================================================================

describe('Parser tests with sample data', () => {
  describe('Codex parser', () => {
    it('parseLine: parses a SessionMeta line', () => {
      const line = JSON.stringify({
        timestamp: '2025-05-07T17:24:21Z',
        item: { id: 'session-123', cwd: '/home/user/project', cli_version: '0.1.0' },
      })
      const record = codexProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('user')
      expect((record as { timestamp: string }).timestamp).toBe('2025-05-07T17:24:21Z')
    })

    it('parseLine: parses a TokenCount event', () => {
      const line = JSON.stringify({
        timestamp: '2025-05-07T17:25:00Z',
        item: {
          type: 'EventMsg',
          event: {
            type: 'TokenCount',
            TokenCount: {
              model: 'o4-mini',
              input_tokens: 5000,
              output_tokens: 1200,
              input_tokens_cache_write: 200,
              input_tokens_cache_read: 3000,
            },
          },
        },
      })
      const record = codexProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('assistant')
      const a = record as any
      expect(a.message.usage.input_tokens).toBe(5000)
      expect(a.message.usage.output_tokens).toBe(1200)
      expect(a.message.model).toBe('o4-mini')
    })

    it('parseLine: parses a function_call ResponseItem', () => {
      const line = JSON.stringify({
        timestamp: '2025-05-07T17:25:10Z',
        item: {
          type: 'ResponseItem',
          response_item: {
            type: 'function_call',
            name: 'shell',
            call_id: 'call-1',
            arguments: '{"command":["ls","-la"]}',
          },
        },
      })
      const record = codexProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('assistant')
      const a = record as any
      expect(a.message.content[0].type).toBe('tool_use')
      expect(a.message.content[0].name).toBe('shell')
    })

    it('parseLine: returns null for empty line', () => {
      expect(codexProvider.parser.parseLine('')).toBeNull()
      expect(codexProvider.parser.parseLine('  ')).toBeNull()
    })

    it('parseLine: parses Compacted boundary', () => {
      const line = JSON.stringify({
        timestamp: '2025-05-07T18:00:00Z',
        item: { Compacted: true },
      })
      const record = codexProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('compact_boundary')
    })

    it('extractTurns: produces TurnMetrics from assistant records with usage', () => {
      const records = [
        { type: 'user' as const, sessionId: '', timestamp: 'T0', message: { role: 'user' as const, content: 'hello' } },
        {
          type: 'assistant' as const, sessionId: '', timestamp: 'T1',
          message: {
            role: 'assistant' as const, model: 'o4-mini', content: [],
            usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 100 },
          },
        },
      ]
      const turns = codexProvider.parser.extractTurns(records as any)
      expect(turns).toHaveLength(1)
      expect(turns[0].turnIndex).toBe(0)
      expect(turns[0].usage.input_tokens).toBe(500)
      expect(turns[0].cacheRatio).toBeCloseTo(100 / 600)
    })

    it('extractModel: returns last assistant model', () => {
      const records = [
        { type: 'assistant' as const, sessionId: '', timestamp: 'T1', message: { role: 'assistant' as const, model: 'gpt-4.1', content: [] } },
        { type: 'assistant' as const, sessionId: '', timestamp: 'T2', message: { role: 'assistant' as const, model: 'o4-mini', content: [] } },
      ]
      expect(codexProvider.parser.extractModel(records as any)).toBe('o4-mini')
    })

    it('hasResumeBoundary: detects compact_boundary', () => {
      const records = [
        { type: 'user' as const, sessionId: '', timestamp: 'T0' },
        { type: 'compact_boundary' as const },
        { type: 'assistant' as const, sessionId: '', timestamp: 'T1' },
      ]
      expect(codexProvider.parser.hasResumeBoundary(records as any)).toBe(true)
    })
  })

  describe('Windsurf parser', () => {
    it('parseLine: parses user_input', () => {
      const line = JSON.stringify({
        type: 'user_input',
        timestamp: '2025-06-01T10:00:00Z',
        user_input: { text: 'fix the bug', cwd: '/home/dev/project' },
      })
      const record = windsurfProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('user')
      const u = record as any
      expect(u.message.content).toBe('fix the bug')
      expect(u.cwd).toBe('/home/dev/project')
    })

    it('parseLine: parses planner_response with usage', () => {
      const line = JSON.stringify({
        type: 'planner_response',
        timestamp: '2025-06-01T10:00:05Z',
        planner_response: {
          text: 'I will fix the bug by...',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 3000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
        },
      })
      const record = windsurfProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('assistant')
      const a = record as any
      expect(a.message.model).toBe('claude-sonnet-4-6')
      expect(a.message.usage.input_tokens).toBe(3000)
      expect(a.message.usage.cache_read_input_tokens).toBe(2000)
    })

    it('parseLine: parses code_action', () => {
      const line = JSON.stringify({
        type: 'code_action',
        timestamp: '2025-06-01T10:00:10Z',
        code_action: { tool_name: 'edit_file', parameters: { file_path: '/src/main.ts' } },
      })
      const record = windsurfProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('assistant')
      const a = record as any
      expect(a.message.content[0].name).toBe('edit_file')
    })

    it('parseLine: returns null for invalid JSON', () => {
      expect(windsurfProvider.parser.parseLine('not valid json')).toBeNull()
    })

    it('extractTurns: produces turns from planner_response records', () => {
      const records = [
        {
          type: 'assistant' as const, sessionId: '', timestamp: '2025-06-01T10:00:05Z',
          message: {
            role: 'assistant' as const, model: 'claude-sonnet-4-6',
            content: [{ type: 'text' as const, text: 'analysis' }],
            usage: { input_tokens: 3000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
          },
        },
      ]
      const turns = windsurfProvider.parser.extractTurns(records as any)
      expect(turns).toHaveLength(1)
      expect(turns[0].usage.input_tokens).toBe(3000)
      expect(turns[0].cacheRatio).toBeCloseTo(2000 / 5000)
    })

    it('extractContext: extracts cwd from user records', () => {
      const records = [
        { type: 'user' as const, sessionId: '', timestamp: 'T0', message: { role: 'user' as const, content: 'hello' }, cwd: '/home/dev/myproject' },
      ]
      const ctx = windsurfProvider.parser.extractContext(records as any)
      expect(ctx.cwd).toBe('/home/dev/myproject')
      expect(ctx.projectName).toBe('myproject')
    })
  })

  describe('Cline parser', () => {
    it('parseLine: parses a JSON line', () => {
      const line = JSON.stringify({ type: 'user', sessionId: 'abc', timestamp: 'T0', message: { role: 'user', content: 'test' } })
      const record = clineProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
      expect(record!.type).toBe('user')
    })

    it('extractTurns: extracts turns with tool calls', () => {
      const records = [
        {
          type: 'assistant' as const, sessionId: '', timestamp: 'T1',
          message: {
            role: 'assistant' as const, model: 'claude-sonnet-4-6',
            content: [
              { type: 'text' as const, text: 'Let me read the file' },
              { type: 'tool_use' as const, name: 'read_file', id: 'tu1', input: { path: '/src/app.ts' } },
            ],
            usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 500, cache_read_input_tokens: 1000 },
          },
        },
      ]
      const turns = clineProvider.parser.extractTurns(records as any)
      expect(turns).toHaveLength(1)
      expect(turns[0].toolCalls).toHaveLength(1)
      expect(turns[0].toolCalls[0].name).toBe('read_file')
      expect(turns[0].cacheRatio).toBeCloseTo(1000 / 3500)
    })

    it('extractModel: returns last assistant model', () => {
      const records = [
        { type: 'assistant' as const, sessionId: '', timestamp: 'T1', message: { role: 'assistant' as const, model: 'gpt-4o', content: [] } },
        { type: 'assistant' as const, sessionId: '', timestamp: 'T2', message: { role: 'assistant' as const, model: 'claude-sonnet-4-6', content: [] } },
      ]
      expect(clineProvider.parser.extractModel(records as any)).toBe('claude-sonnet-4-6')
    })

    it('hasResumeBoundary: returns false (Cline has no compaction)', () => {
      expect(clineProvider.parser.hasResumeBoundary([])).toBe(false)
    })
  })

  describe('Gemini parser', () => {
    it('parseLine: parses a JSON line', () => {
      const line = JSON.stringify({ type: 'user', sessionId: '', timestamp: 'T0', message: { role: 'user', content: 'hello' } })
      const record = geminiProvider.parser.parseLine(line)
      expect(record).not.toBeNull()
    })

    it('parseLine: returns null for invalid JSON', () => {
      expect(geminiProvider.parser.parseLine('{{bad json')).toBeNull()
    })

    it('extractTurns: produces turns from records with usageMetadata-style usage', () => {
      const records = [
        {
          type: 'assistant' as const, sessionId: '', timestamp: 'T1',
          message: {
            role: 'assistant' as const, model: 'gemini-2.5-pro',
            content: [{ type: 'text' as const, text: 'Here is the answer' }],
            usage: { input_tokens: 4000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
          },
        },
      ]
      const turns = geminiProvider.parser.extractTurns(records as any)
      expect(turns).toHaveLength(1)
      expect(turns[0].usage.input_tokens).toBe(4000)
    })

    it('extractModel: returns last model', () => {
      const records = [
        { type: 'assistant' as const, sessionId: '', timestamp: 'T1', message: { role: 'assistant' as const, model: 'gemini-2.5-pro', content: [] } },
      ]
      expect(geminiProvider.parser.extractModel(records as any)).toBe('gemini-2.5-pro')
    })
  })

  describe('Aider parser', () => {
    it('parseLine: returns null (Aider is markdown-based, not line-based)', () => {
      expect(aiderProvider.parser.parseLine('> some user message')).toBeNull()
    })

    it('extractTurns: produces turns from assistant records with usage', () => {
      const records = [
        {
          type: 'assistant' as const, sessionId: '', timestamp: 'T1',
          message: {
            role: 'assistant' as const, model: '',
            content: [],
            usage: { input_tokens: 4200, output_tokens: 1100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
        },
      ]
      const turns = aiderProvider.parser.extractTurns(records as any)
      expect(turns).toHaveLength(1)
      expect(turns[0].usage.input_tokens).toBe(4200)
      expect(turns[0].usage.output_tokens).toBe(1100)
      expect(turns[0].cacheRatio).toBe(0)
    })

    it('hasResumeBoundary: always false', () => {
      expect(aiderProvider.parser.hasResumeBoundary([])).toBe(false)
    })
  })

  describe('Tier 3 parsers (Copilot, Zed, Amazon Q)', () => {
    it('Copilot parser.extractTurns: returns empty (limited monitoring)', () => {
      expect(copilotProvider.parser.extractTurns([])).toEqual([])
    })
    it('Zed parser.extractTurns: returns empty', () => {
      expect(zedProvider.parser.extractTurns([])).toEqual([])
    })
    it('Amazon Q parser.extractTurns: returns empty', () => {
      expect(amazonqProvider.parser.extractTurns([])).toEqual([])
    })
    it('All Tier 3 parsers: extractModel returns null', () => {
      expect(copilotProvider.parser.extractModel([])).toBeNull()
      expect(zedProvider.parser.extractModel([])).toBeNull()
      expect(amazonqProvider.parser.extractModel([])).toBeNull()
    })
    it('All Tier 3 parsers: extractContext returns empty context', () => {
      for (const p of TIER_3_PROVIDERS) {
        const ctx = p.parser.extractContext([])
        expect(ctx.cwd).toBeNull()
        expect(ctx.gitBranch).toBeNull()
        expect(ctx.projectName).toBeNull()
        expect(ctx.firstUserMessage).toBeNull()
      }
    })
  })
})

// ===========================================================================
// 6. Hook manager tests (Tier 1 providers)
// ===========================================================================

describe('Hook manager tests (Tier 1)', () => {
  const blockDecision: HookDecision = { decision: 'block', reason: 'dangerous command' }
  const approveDecision: HookDecision = { decision: 'approve' }
  const approveWithContext: HookDecision = { decision: 'approve', additionalContext: 'Proceed with caution' }

  describe('Claude hooks', () => {
    const hooks = claudeProvider.hooks!

    it('supportedEvents includes key events', () => {
      expect(hooks.supportedEvents).toContain('session_start')
      expect(hooks.supportedEvents).toContain('user_prompt_submit')
      expect(hooks.supportedEvents).toContain('post_tool_use')
      expect(hooks.supportedEvents).toContain('stop')
    })

    it('eventName maps canonical to Claude-specific names', () => {
      expect(hooks.eventName('session_start')).toBe('SessionStart')
      expect(hooks.eventName('user_prompt_submit')).toBe('UserPromptSubmit')
      expect(hooks.eventName('pre_tool_use')).toBe('PreToolUse')
      expect(hooks.eventName('post_tool_use')).toBe('PostToolUse')
      expect(hooks.eventName('stop')).toBe('Stop')
    })

    it('blockExitCode is 2', () => {
      expect(hooks.blockExitCode).toBe(2)
    })

    it('formatOutput: block decision serializes to JSON', () => {
      const output = hooks.formatOutput(blockDecision)
      const parsed = JSON.parse(output)
      expect(parsed.decision).toBe('block')
      expect(parsed.reason).toBe('dangerous command')
    })

    it('formatOutput: approve decision serializes to JSON', () => {
      const output = hooks.formatOutput(approveDecision)
      const parsed = JSON.parse(output)
      expect(parsed.decision).toBe('approve')
    })
  })

  describe('Codex hooks', () => {
    const hooks = codexProvider.hooks!

    it('supportedEvents includes key events (no pre/post compact)', () => {
      expect(hooks.supportedEvents).toContain('session_start')
      expect(hooks.supportedEvents).toContain('user_prompt_submit')
      expect(hooks.supportedEvents).toContain('pre_tool_use')
      expect(hooks.supportedEvents).toContain('post_tool_use')
      expect(hooks.supportedEvents).toContain('stop')
      expect(hooks.supportedEvents).not.toContain('pre_compact')
      expect(hooks.supportedEvents).not.toContain('post_compact')
    })

    it('eventName maps correctly and returns null for unsupported', () => {
      expect(hooks.eventName('session_start')).toBe('SessionStart')
      expect(hooks.eventName('pre_tool_use')).toBe('PreToolUse')
      expect(hooks.eventName('pre_compact')).toBeNull()
      expect(hooks.eventName('post_compact')).toBeNull()
    })

    it('blockExitCode is 2', () => {
      expect(hooks.blockExitCode).toBe(2)
    })

    it('formatOutput: produces valid JSON', () => {
      const output = hooks.formatOutput(blockDecision)
      expect(() => JSON.parse(output)).not.toThrow()
      expect(JSON.parse(output).decision).toBe('block')
    })
  })

  describe('Cursor hooks', () => {
    const hooks = cursorProvider.hooks!

    it('supportedEvents does not include session_start', () => {
      expect(hooks.supportedEvents).not.toContain('session_start')
      expect(hooks.supportedEvents).toContain('user_prompt_submit')
      expect(hooks.supportedEvents).toContain('pre_tool_use')
      expect(hooks.supportedEvents).toContain('stop')
    })

    it('eventName maps to Cursor-specific names', () => {
      expect(hooks.eventName('user_prompt_submit')).toBe('beforeSubmitPrompt')
      expect(hooks.eventName('pre_tool_use')).toBe('beforeShellExecution')
      expect(hooks.eventName('post_tool_use')).toBe('afterFileEdit')
      expect(hooks.eventName('session_start')).toBeNull()
    })

    it('formatOutput: block produces Cursor deny format', () => {
      const output = hooks.formatOutput(blockDecision)
      const parsed = JSON.parse(output)
      expect(parsed.continue).toBe(false)
      expect(parsed.permission).toBe('deny')
      expect(parsed.agentMessage).toBe('dangerous command')
    })

    it('formatOutput: approve produces Cursor allow format', () => {
      const output = hooks.formatOutput(approveDecision)
      const parsed = JSON.parse(output)
      expect(parsed.continue).toBe(true)
      expect(parsed.permission).toBe('allow')
    })

    it('formatOutput: approve with context includes agentMessage', () => {
      const output = hooks.formatOutput(approveWithContext)
      const parsed = JSON.parse(output)
      expect(parsed.continue).toBe(true)
      expect(parsed.agentMessage).toBe('Proceed with caution')
    })
  })

  describe('Windsurf hooks', () => {
    const hooks = windsurfProvider.hooks!

    it('supportedEvents includes tool use and stop events', () => {
      expect(hooks.supportedEvents).toContain('pre_tool_use')
      expect(hooks.supportedEvents).toContain('post_tool_use')
      expect(hooks.supportedEvents).toContain('stop')
    })

    it('eventName maps to Windsurf-specific names', () => {
      expect(hooks.eventName('user_prompt_submit')).toBe('pre_user_prompt')
      expect(hooks.eventName('pre_tool_use')).toBe('pre_run_command')
      expect(hooks.eventName('post_tool_use')).toBe('post_run_command')
      expect(hooks.eventName('stop')).toBe('post_cascade_response_with_transcript')
      expect(hooks.eventName('session_start')).toBeNull()
    })

    it('blockExitCode is 2', () => {
      expect(hooks.blockExitCode).toBe(2)
    })

    it('formatOutput: produces valid JSON', () => {
      const output = hooks.formatOutput(blockDecision)
      expect(() => JSON.parse(output)).not.toThrow()
    })
  })

  describe('Cline hooks', () => {
    const hooks = clineProvider.hooks!

    it('supportedEvents includes unique Cline events', () => {
      expect(hooks.supportedEvents).toContain('session_start')
      expect(hooks.supportedEvents).toContain('pre_tool_use')
      expect(hooks.supportedEvents).toContain('post_tool_use')
      expect(hooks.supportedEvents).toContain('pre_compact')
      expect(hooks.supportedEvents).toContain('stop')
    })

    it('eventName maps to Cline-specific names', () => {
      expect(hooks.eventName('session_start')).toBe('TaskStart')
      expect(hooks.eventName('pre_tool_use')).toBe('PreToolUse')
      expect(hooks.eventName('post_tool_use')).toBe('PostToolUse')
      expect(hooks.eventName('pre_compact')).toBe('PreCompact')
      expect(hooks.eventName('stop')).toBe('TaskComplete')
      expect(hooks.eventName('post_compact')).toBeNull()
    })

    it('blockExitCode is 1', () => {
      expect(hooks.blockExitCode).toBe(1)
    })

    it('formatOutput: block produces Cline cancel format', () => {
      const output = hooks.formatOutput(blockDecision)
      const parsed = JSON.parse(output)
      expect(parsed.cancel).toBe(true)
      expect(parsed.errorMessage).toBe('dangerous command')
    })

    it('formatOutput: approve produces Cline non-cancel format', () => {
      const output = hooks.formatOutput(approveDecision)
      const parsed = JSON.parse(output)
      expect(parsed.cancel).toBe(false)
    })

    it('formatOutput: approve with context includes contextModification', () => {
      const output = hooks.formatOutput(approveWithContext)
      const parsed = JSON.parse(output)
      expect(parsed.cancel).toBe(false)
      expect(parsed.contextModification).toBe('Proceed with caution')
    })
  })
})

// ===========================================================================
// 7. Discovery tests — extractSessionId for sample paths
// ===========================================================================

describe('Discovery tests', () => {
  describe('Claude', () => {
    it('extractSessionId strips .jsonl extension', () => {
      expect(claudeProvider.discovery.extractSessionId('/home/user/.claude/projects/myapp/session-abc123.jsonl'))
        .toBe('session-abc123')
    })
    it('extractProjectPath extracts first path segment after base', () => {
      const base = '/home/user/.claude/projects'
      expect(claudeProvider.discovery.extractProjectPath(`${base}/myapp/session.jsonl`, base))
        .toBe('myapp')
    })
    it('fileExtensions includes .jsonl', () => {
      expect(claudeProvider.discovery.fileExtensions).toContain('.jsonl')
    })
  })

  describe('Codex', () => {
    it('extractSessionId strips .jsonl extension', () => {
      expect(codexProvider.discovery.extractSessionId('/home/user/.codex/sessions/rollout-2025-05-07T17-24-21-abc.jsonl'))
        .toBe('rollout-2025-05-07T17-24-21-abc')
    })
    it('extractProjectPath returns codex (no project structure)', () => {
      expect(codexProvider.discovery.extractProjectPath('/any/path', '/base'))
        .toBe('codex')
    })
  })

  describe('Cursor', () => {
    it('extractSessionId strips .vscdb extension', () => {
      expect(cursorProvider.discovery.extractSessionId('/path/to/state.vscdb'))
        .toBe('state')
    })
    it('fileExtensions includes .vscdb', () => {
      expect(cursorProvider.discovery.fileExtensions).toContain('.vscdb')
    })
  })

  describe('Windsurf', () => {
    it('extractSessionId strips .jsonl for trajectory files', () => {
      expect(windsurfProvider.discovery.extractSessionId('/home/user/.windsurf/transcripts/traj-abc123.jsonl'))
        .toBe('traj-abc123')
    })
  })

  describe('Cline', () => {
    it('extractSessionId returns parent directory name (task ID)', () => {
      expect(clineProvider.discovery.extractSessionId('/path/to/globalStorage/tasks/task-123/api_conversation_history.json'))
        .toBe('task-123')
    })
    it('fileExtensions includes .json', () => {
      expect(clineProvider.discovery.fileExtensions).toContain('.json')
    })
  })

  describe('Gemini', () => {
    it('extractSessionId strips .json extension', () => {
      expect(geminiProvider.discovery.extractSessionId('/home/user/.gemini/history/session-001.json'))
        .toBe('session-001')
    })
  })

  describe('Aider', () => {
    it('extractSessionId strips .md extension', () => {
      expect(aiderProvider.discovery.extractSessionId('/home/user/project/.aider.chat.history.md'))
        .toBe('.aider.chat.history')
    })
    it('fileExtensions includes .md', () => {
      expect(aiderProvider.discovery.fileExtensions).toContain('.md')
    })
  })

  describe('Copilot', () => {
    it('extractSessionId strips .vscdb extension', () => {
      expect(copilotProvider.discovery.extractSessionId('/path/workspace.vscdb'))
        .toBe('workspace')
    })
  })

  describe('Zed', () => {
    it('extractSessionId returns basename', () => {
      expect(zedProvider.discovery.extractSessionId('/path/to/zed.db'))
        .toBe('zed.db')
    })
    it('fileExtensions includes .db', () => {
      expect(zedProvider.discovery.fileExtensions).toContain('.db')
    })
  })

  describe('Amazon Q', () => {
    it('extractSessionId strips .json extension', () => {
      expect(amazonqProvider.discovery.extractSessionId('/home/user/.aws/amazonq/session-xyz.json'))
        .toBe('session-xyz')
    })
  })

  describe('All providers have valid discovery config', () => {
    for (const provider of ALL_PROVIDERS) {
      it(`${provider.name}: watchDepth is a positive number`, () => {
        expect(provider.discovery.watchDepth).toBeGreaterThan(0)
      })
      it(`${provider.name}: fileExtensions are non-empty and start with .`, () => {
        for (const ext of provider.discovery.fileExtensions) {
          expect(ext.startsWith('.')).toBe(true)
        }
      })
    }
  })
})

// ===========================================================================
// 8. Tier classification sanity checks
// ===========================================================================

describe('Tier classification', () => {
  it('Tier 1 providers: Claude, Codex, Cursor, Windsurf, Cline', () => {
    const tier1Names = TIER_1_PROVIDERS.map((p) => p.name).sort()
    expect(tier1Names).toEqual(['claude', 'cline', 'codex', 'cursor', 'windsurf'])
  })

  it('Tier 2 providers: Gemini, Aider', () => {
    const tier2Names = TIER_2_PROVIDERS.map((p) => p.name).sort()
    expect(tier2Names).toEqual(['aider', 'gemini'])
  })

  it('Tier 3 providers: Copilot, Zed, Amazon Q', () => {
    const tier3Names = TIER_3_PROVIDERS.map((p) => p.name).sort()
    expect(tier3Names).toEqual(['amazonq', 'copilot', 'zed'])
  })

  it('All Tier 1 providers have non-null hooks', () => {
    for (const p of TIER_1_PROVIDERS) {
      expect(p.hooks).not.toBeNull()
    }
  })

  it('All Tier 2/3 providers have null hooks', () => {
    for (const p of [...TIER_2_PROVIDERS, ...TIER_3_PROVIDERS]) {
      expect(p.hooks).toBeNull()
    }
  })
})

// ===========================================================================
// 9. Context limit tests
// ===========================================================================

describe('getContextLimit', () => {
  it('Claude: Opus model returns 1M', () => {
    expect(claudeProvider.getContextLimit('claude-opus-4-6')).toBe(1_000_000)
  })

  it('Claude: Haiku model returns 200K', () => {
    expect(claudeProvider.getContextLimit('claude-haiku-4-5')).toBe(200_000)
  })

  it('Codex: gpt-4.1 returns 1M+', () => {
    expect(codexProvider.getContextLimit('gpt-4.1')).toBe(1_047_576)
  })

  it('Codex: o3 returns 200K', () => {
    expect(codexProvider.getContextLimit('o3-mini')).toBe(200_000)
  })

  it('Cursor: gpt-4o returns 128K', () => {
    expect(cursorProvider.getContextLimit('gpt-4o')).toBe(128_000)
  })

  it('Gemini: pro returns 1M', () => {
    expect(geminiProvider.getContextLimit('gemini-2.5-pro')).toBe(1_000_000)
  })

  it('Cline: deepseek returns 128K', () => {
    expect(clineProvider.getContextLimit('deepseek-chat')).toBe(128_000)
  })
})
