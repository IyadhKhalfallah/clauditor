import { basename, sep } from 'node:path'
import type { SessionDiscovery } from '../types.js'

export const claudeDiscovery: SessionDiscovery = {
  fileExtensions: ['.jsonl'],
  watchDepth: 4,

  extractSessionId(filePath: string): string {
    return basename(filePath).replace('.jsonl', '')
  },

  extractProjectPath(filePath: string, baseDir: string): string {
    const relative = filePath
      .replace(baseDir + sep, '')
      .replace(baseDir + '/', '')
    const parts = relative.split(sep)
    return parts[0] || 'unknown'
  },
}
