import type { ToolNameMapper, CanonicalTool } from '../types.js'

const TOOL_MAP: Record<string, CanonicalTool> = {
  execute_command: 'bash_execute',
  read_file: 'file_read',
  write_to_file: 'file_write',
  replace_in_file: 'file_edit',
  apply_patch: 'file_edit',
  search_files: 'file_search',
  list_files: 'file_search',
  list_code_definition_names: 'file_search',
  browser_action: 'browser',
  use_mcp_tool: 'mcp_tool',
  access_mcp_resource: 'mcp_tool',
  web_fetch: 'web_fetch',
  web_search: 'web_search',
  ask_followup_question: 'other',
  attempt_completion: 'other',
  new_task: 'other',
  use_skill: 'other',
  use_subagents: 'other',
}

const REVERSE_MAP: Record<CanonicalTool, string> = {
  bash_execute: 'execute_command',
  file_read: 'read_file',
  file_write: 'write_to_file',
  file_edit: 'replace_in_file',
  file_search: 'search_files',
  web_search: 'web_search',
  web_fetch: 'web_fetch',
  browser: 'browser_action',
  mcp_tool: 'use_mcp_tool',
  other: 'execute_command',
}

export const clineTools: ToolNameMapper = {
  toCanonical(providerToolName: string): CanonicalTool {
    return TOOL_MAP[providerToolName] ?? 'other'
  },
  fromCanonical(canonical: CanonicalTool): string {
    return REVERSE_MAP[canonical] ?? 'execute_command'
  },
  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>
    switch (toolName) {
      case 'execute_command': {
        const cmd = typeof obj.command === 'string' ? obj.command : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'read_file':
      case 'write_to_file':
      case 'replace_in_file': {
        const fp = typeof obj.path === 'string' ? obj.path : ''
        return fp.split(/[/\\]/).pop() || ''
      }
      default:
        return ''
    }
  },
}
