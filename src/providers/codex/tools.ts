import type { ToolNameMapper, CanonicalTool } from '../types.js'

const TOOL_MAP: Record<string, CanonicalTool> = {
  shell: 'bash_execute',
  exec_command: 'bash_execute',
  write_stdin: 'bash_execute',
  apply_patch: 'file_edit',
  list_dir: 'file_read',
  view_image: 'file_read',
  js_repl: 'bash_execute',
  js_repl_reset: 'bash_execute',
  plan: 'other',
  request_permissions: 'other',
  request_user_input: 'other',
  tool_search: 'other',
  tool_suggest: 'other',
  code_mode_execute: 'bash_execute',
  code_mode_wait: 'other',
}

const REVERSE_MAP: Record<CanonicalTool, string> = {
  bash_execute: 'shell',
  file_read: 'list_dir',
  file_write: 'apply_patch',
  file_edit: 'apply_patch',
  file_search: 'shell',
  web_search: 'shell',
  web_fetch: 'shell',
  browser: 'shell',
  mcp_tool: 'shell',
  other: 'shell',
}

export const codexTools: ToolNameMapper = {
  toCanonical(providerToolName: string): CanonicalTool {
    return TOOL_MAP[providerToolName] ?? 'other'
  },

  fromCanonical(canonical: CanonicalTool): string {
    return REVERSE_MAP[canonical] ?? 'shell'
  },

  extractInputLabel(toolName: string, input: unknown): string {
    if (!input || typeof input !== 'object') return ''
    const obj = input as Record<string, unknown>

    switch (toolName) {
      case 'shell': {
        // Codex shell takes { command: string[] }
        const cmd = Array.isArray(obj.command)
          ? (obj.command as string[]).join(' ')
          : typeof obj.command === 'string' ? obj.command : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'exec_command': {
        const cmd = typeof obj.cmd === 'string' ? obj.cmd : ''
        return cmd.split('\n')[0].trim().slice(0, 60)
      }
      case 'apply_patch': {
        const patch = typeof obj.patch === 'string' ? obj.patch : ''
        // Extract first file path from patch content
        const match = patch.match(/^(?:---|\+\+\+)\s+(.+)/m)
        return match ? match[1].split(/[/\\]/).pop() || '' : ''
      }
      case 'list_dir': {
        const dir = typeof obj.path === 'string' ? obj.path : ''
        return dir.split(/[/\\]/).pop() || dir
      }
      default:
        return ''
    }
  },
}
