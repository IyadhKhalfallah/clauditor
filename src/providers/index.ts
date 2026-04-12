/**
 * Provider system entry point.
 *
 * Registers all known providers and exports the registry for use
 * throughout clauditor.
 */

export { registry } from './registry.js'
export type {
  Provider,
  DirectoryResolver,
  SessionParser,
  SessionDiscovery,
  PricingResolver,
  ToolNameMapper,
  HookManager,
  CanonicalTool,
  CanonicalHookEvent,
  ProviderTier,
  SessionContext,
} from './types.js'

// Register all built-in providers
import { registry } from './registry.js'
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

// Tier 1 — full hooks + session monitoring
registry.register(claudeProvider)
registry.register(codexProvider)
registry.register(cursorProvider)
registry.register(windsurfProvider)
registry.register(clineProvider)

// Tier 2 — session monitoring only
registry.register(geminiProvider)
registry.register(aiderProvider)

// Tier 3 — limited monitoring
registry.register(copilotProvider)
registry.register(zedProvider)
registry.register(amazonqProvider)
