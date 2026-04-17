import { basename } from 'node:path'
import type { SessionDiscovery } from '../types.js'

export const windsurfDiscovery: SessionDiscovery = {
  fileExtensions: ['.jsonl'],
  watchDepth: 1, // ~/.windsurf/transcripts/ is flat

  extractSessionId(filePath: string): string {
    // trajectory_id is the filename without extension
    return basename(filePath).replace('.jsonl', '')
  },

  extractProjectPath(filePath: string, _baseDir: string): string {
    return 'windsurf'
  },
}
