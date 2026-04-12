import { basename } from 'node:path'
import type { SessionDiscovery } from '../types.js'

/**
 * Cursor stores sessions in SQLite (state.vscdb), not as individual files.
 * Discovery here handles the case where we export sessions to JSONL for monitoring.
 * Direct SQLite reading is handled by the parser.
 */
export const cursorDiscovery: SessionDiscovery = {
  fileExtensions: ['.vscdb'],
  watchDepth: 2,

  extractSessionId(filePath: string): string {
    return basename(filePath).replace('.vscdb', '')
  },

  extractProjectPath(filePath: string, _baseDir: string): string {
    // Cursor uses workspace hashes — can look up workspace.json for real paths
    return 'cursor'
  },
}
