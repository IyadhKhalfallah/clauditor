const STANDARD_CONTEXT = 200_000
const EXTENDED_CONTEXT = 1_000_000

/**
 * Context window for a session. The transcript's model id doesn't say whether
 * the 1M window is on (e.g. `claude-sonnet-4-6` runs with or without it), so
 * a context already past 200k proves the extended window — otherwise any
 * non-Opus 1M session gets "Context window is 150% full" on every tool call.
 */
export function getContextLimit(model: string | null | undefined, contextSize: number): number {
  if (model?.includes('opus')) return EXTENDED_CONTEXT
  return contextSize > STANDARD_CONTEXT ? EXTENDED_CONTEXT : STANDARD_CONTEXT
}
