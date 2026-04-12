/**
 * Claude Code session parser — wraps the existing daemon/parser.ts functions
 * to implement the SessionParser interface.
 */
import type { SessionParser, SessionContext } from '../types.js'
import type { SessionRecord, TurnMetrics } from '../../types.js'
import {
  parseJsonlLine,
  parseJsonlFile,
  extractTurns,
  extractModel,
  extractSessionContext,
} from '../../daemon/parser.js'
import { hasResumeBoundary } from '../../features/resume-detector.js'

export const claudeParser: SessionParser = {
  parseLine(line: string): SessionRecord | null {
    return parseJsonlLine(line)
  },

  parseFile(filePath: string): Promise<SessionRecord[]> {
    return parseJsonlFile(filePath)
  },

  extractTurns(records: SessionRecord[]): TurnMetrics[] {
    return extractTurns(records)
  },

  extractModel(records: SessionRecord[]): string | null {
    return extractModel(records)
  },

  extractContext(records: SessionRecord[]): SessionContext {
    return extractSessionContext(records)
  },

  hasResumeBoundary(records: SessionRecord[]): boolean {
    return hasResumeBoundary(records)
  },
}
