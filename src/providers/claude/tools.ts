import type { ToolNameMapper, CanonicalTool } from '../types.js'

const TOOL_MAP: Record<string, CanonicalTool> = {
  Bash: 'bash_execute',
  Read: 'file_read',
  Write: 'file_write',
  Edit: 'file_edit',
  Glob: 'file_search',
  Grep: 'file_search',
  View: 'file_read',
  WebSearch: 'web_search',
  WebFetch: 'web_fetch',
  Agent: 'other',
  NotebookEdit: 'file_edit',
}

const REVERSE_MAP: Record<CanonicalTool, string> = {
  bash_execute: 'Bash',
  file_read: 'Read',
  file_write: 'Write',
  file_edit: 'Edit',
  file_search: 'Grep',
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  browser: 'Bash',
  mcp_tool: 'Bash',
  other: 'Bash',
}

export const claudeTools: ToolNameMapper = {
  toCanonical(providerToolName: string): CanonicalTool {
    return TOOL_MAP[providerToolName] ?? 'other'
  },

  fromCanonical(canonical: CanonicalTool): string {
    return REVERSE_MAP[canonical] ?? 'Bash'
  },

  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>

    switch (toolName) {
      case 'Bash': {
        const cmd = typeof obj.command === 'string' ? obj.command : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'Read':
      case 'Edit':
      case 'Write': {
        const fp = typeof obj.file_path === 'string' ? obj.file_path : ''
        return fp.split(/[/\\]/).pop() || ''
      }
      default:
        return ''
    }
  },
}
