import type { ToolNameMapper, CanonicalTool } from '../types.js'

const TOOL_MAP: Record<string, CanonicalTool> = {
  run_command: 'bash_execute',
  edit_file: 'file_edit',
  write_file: 'file_write',
  view_file: 'file_read',
  view_code_item: 'file_read',
  find: 'file_search',
  grep_search: 'file_search',
  list_directory: 'file_read',
  codebase_search: 'file_search',
  search_web: 'web_search',
  read_url_content: 'web_fetch',
  view_web_document_chunk: 'web_fetch',
}

const REVERSE_MAP: Record<CanonicalTool, string> = {
  bash_execute: 'run_command',
  file_read: 'view_file',
  file_write: 'write_file',
  file_edit: 'edit_file',
  file_search: 'grep_search',
  web_search: 'search_web',
  web_fetch: 'read_url_content',
  browser: 'search_web',
  mcp_tool: 'run_command',
  other: 'run_command',
}

export const windsurfTools: ToolNameMapper = {
  toCanonical(providerToolName: string): CanonicalTool {
    return TOOL_MAP[providerToolName] ?? 'other'
  },

  fromCanonical(canonical: CanonicalTool): string {
    return REVERSE_MAP[canonical] ?? 'run_command'
  },

  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>

    switch (toolName) {
      case 'run_command': {
        const cmd = typeof obj.command === 'string' ? obj.command : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'edit_file':
      case 'write_file':
      case 'view_file': {
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
