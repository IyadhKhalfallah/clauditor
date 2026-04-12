import { basename } from 'node:path'
import type { SessionDiscovery } from '../types.js'

export const codexDiscovery: SessionDiscovery = {
  fileExtensions: ['.jsonl'],
  watchDepth: 2, // ~/.codex/sessions/ is flat or has archived/

  extractSessionId(filePath: string): string {
    // Codex files: rollout-2025-05-07T17-24-21-<uuid>.jsonl
    return basename(filePath).replace('.jsonl', '')
  },

  extractProjectPath(filePath: string, _baseDir: string): string {
    // Codex doesn't organize by project — use the session meta's cwd
    return 'codex'
  },
}
