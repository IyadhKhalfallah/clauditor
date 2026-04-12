import type { ToolNameMapper, CanonicalTool } from '../types.js'

const TOOL_MAP: Record<string, CanonicalTool> = {
  run_terminal_command: 'bash_execute',
  shell_execution: 'bash_execute',
  read_file: 'file_read',
  edit_file: 'file_edit',
  file_edit: 'file_edit',
  delete_file: 'file_write',
  codebase_search: 'file_search',
  file_search: 'file_search',
  grep_search: 'file_search',
  list_directory: 'file_read',
  web_search: 'web_search',
  browser_action: 'browser',
  mcp_tool: 'mcp_tool',
}

const REVERSE_MAP: Record<CanonicalTool, string> = {
  bash_execute: 'run_terminal_command',
  file_read: 'read_file',
  file_write: 'edit_file',
  file_edit: 'edit_file',
  file_search: 'codebase_search',
  web_search: 'web_search',
  web_fetch: 'web_search',
  browser: 'browser_action',
  mcp_tool: 'mcp_tool',
  other: 'run_terminal_command',
}

export const cursorTools: ToolNameMapper = {
  toCanonical(providerToolName: string): CanonicalTool {
    return TOOL_MAP[providerToolName] ?? 'other'
  },

  fromCanonical(canonical: CanonicalTool): string {
    return REVERSE_MAP[canonical] ?? 'run_terminal_command'
  },

  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>

    switch (toolName) {
      case 'run_terminal_command':
      case 'shell_execution': {
        const cmd = typeof obj.command === 'string' ? obj.command : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'read_file':
      case 'edit_file':
      case 'file_edit': {
        const fp = typeof obj.file_path === 'string'
          ? obj.file_path
          : typeof obj.path === 'string' ? obj.path : ''
        return fp.split(/[/\\]/).pop() || ''
      }
      default:
        return ''
    }
  },
}
