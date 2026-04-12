import { basename, dirname } from 'node:path'
import type { SessionDiscovery } from '../types.js'

export const clineDiscovery: SessionDiscovery = {
  fileExtensions: ['.json'],
  watchDepth: 3,

  extractSessionId(filePath: string): string {
    // Task dirs: globalStorage/tasks/<taskId>/api_conversation_history.json
    return basename(dirname(filePath))
  },

  extractProjectPath(filePath: string, _baseDir: string): string {
    return 'cline'
  },
}
