import { getProjectHubConfig, type ProjectHubConfig } from '../config.js'
import { getGitRemoteUrl, getProjectHash } from './git-project.js'

// No default hub URL — must be configured via `clauditor team join --hub-url`

/**
 * Resolve hub config for the current working directory.
 * Returns null if not a git repo or no team configured for this project.
 */
export function resolveHubContext(cwd?: string): {
  projectHash: string
  remoteUrl: string
  config: ProjectHubConfig
} | null {
  const remoteUrl = getGitRemoteUrl(cwd)
  if (!remoteUrl) return null

  const config = getProjectHubConfig(remoteUrl)
  if (!config) return null

  const projectHash = getProjectHash(cwd)
  if (!projectHash) return null

  return { projectHash, remoteUrl, config }
}

async function hubFetch(
  path: string,
  hubConfig: ProjectHubConfig,
  options: RequestInit = {}
): Promise<Response> {
  if (!hubConfig.url) throw new Error('Hub URL not configured. Run `clauditor team join --hub-url <url>`')
  const url = `${hubConfig.url}${path}`
  const res = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(15000),
    headers: {
      'X-Clauditor-Key': hubConfig.apiKey,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return res
}

// Hub API methods:

export async function teamJoin(
  apiKey: string,
  developerHash: string,
  hubUrl?: string
): Promise<{ team_name: string; team_id: string; project_count: number; plan: string }> {
  if (!hubUrl) throw new Error('Hub URL is required. Use --hub-url <url>')
  const url = hubUrl
  const res = await fetch(`${url}/api/v1/team/join`, {
    method: 'POST',
    headers: { 'X-Clauditor-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, developer_hash: developerHash }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((data.error as string) || `Hub returned ${res.status}`)
  }
  return res.json() as Promise<{
    team_name: string
    team_id: string
    project_count: number
    plan: string
  }>
}

export async function pushKnowledge(
  projectHash: string,
  developerHash: string,
  fragments: Array<{ type: string; content: Record<string, unknown> }>,
  hubConfig: ProjectHubConfig,
  projectName?: string
): Promise<{ pushed: number; project_id: string }> {
  const res = await hubFetch('/api/v1/knowledge/push', hubConfig, {
    method: 'POST',
    body: JSON.stringify({ project_hash: projectHash, developer_hash: developerHash, fragments, project_name: projectName || null }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((data.error as string) || `Push failed: ${res.status}`)
  }
  return res.json() as Promise<{ pushed: number; project_id: string }>
}

export async function pullBrain(
  projectHash: string,
  hubConfig: ProjectHubConfig,
  etag?: string
): Promise<{
  content: unknown
  version: number
  token_count: number
  fragment_count: number
  etag: string
} | null> {
  const headers: Record<string, string> = {}
  if (etag) headers['If-None-Match'] = etag

  const res = await hubFetch(
    `/api/v1/knowledge/pull?project_hash=${encodeURIComponent(projectHash)}`,
    hubConfig,
    { headers }
  )

  if (res.status === 304) return null
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Pull failed: ${res.status}`)

  const data = (await res.json()) as Record<string, unknown>
  return {
    ...data,
    etag: res.headers.get('etag') || '',
  } as { content: unknown; version: number; token_count: number; fragment_count: number; etag: string }
}

export async function pullCoreTier(
  projectHash: string,
  hubConfig: ProjectHubConfig
): Promise<{ core: string; token_estimate: number } | null> {
  const res = await hubFetch(
    `/api/v1/knowledge/pull?project_hash=${encodeURIComponent(projectHash)}&tier=core`,
    hubConfig
  )
  if (!res.ok) return null
  const data = (await res.json()) as { core: string; token_estimate: number }
  if (!data.core) return null
  return data
}

export interface KnowledgeQueryEntry {
  id: string
  entry_type: string
  title: string
  body: Record<string, unknown>
  confidence: number
  effective_confidence: number
  hit_count: number
  related_files: string[]
  tags: string[]
}

export async function queryKnowledge(
  projectHash: string,
  contextType: 'command' | 'file',
  contextValue: string,
  hubConfig: ProjectHubConfig
): Promise<{ entries: KnowledgeQueryEntry[]; count: number }> {
  const res = await hubFetch(
    `/api/v1/knowledge/query?project_hash=${encodeURIComponent(projectHash)}` +
    `&context_type=${encodeURIComponent(contextType)}` +
    `&context_value=${encodeURIComponent(contextValue)}`,
    hubConfig
  )
  if (!res.ok) return { entries: [], count: 0 }
  return res.json() as Promise<{ entries: KnowledgeQueryEntry[]; count: number }>
}

export async function checkCommand(
  projectHash: string,
  command: string,
  hubConfig: ProjectHubConfig
): Promise<{ known_error: { error_message: string; fix_command: string; confidence: number } | null }> {
  const res = await hubFetch(
    `/api/v1/knowledge/check?project_hash=${encodeURIComponent(projectHash)}&command=${encodeURIComponent(command)}`,
    hubConfig
  )
  if (!res.ok) return { known_error: null }
  return res.json() as Promise<{
    known_error: { error_message: string; fix_command: string; confidence: number } | null
  }>
}

export async function discoverSkills(
  hubConfig: ProjectHubConfig,
  projectHash?: string
): Promise<Array<{ id: string; name: string; description: string }>> {
  const params = projectHash ? `?project_hash=${encodeURIComponent(projectHash)}` : ''
  const res = await hubFetch(`/api/v1/skills/discover${params}`, hubConfig)
  if (!res.ok) return []
  const data = (await res.json()) as { skills?: Array<{ id: string; name: string; description: string }> }
  return data.skills || []
}
