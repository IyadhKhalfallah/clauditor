/**
 * Auto-memory team sync — reads Claude Code's auto-memory and pushes to hub.
 *
 * Claude Code stores auto-memory at ~/.claude/projects/<project>/memory/
 * in markdown files with YAML frontmatter. These are the highest quality
 * knowledge entries — written voluntarily by Claude with full context.
 *
 * This module reads those files, hashes them for dedup, and syncs
 * new/updated entries to the hub so team members can benefit.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { scrubSecrets } from '../features/secret-scrubber.js'

export interface MemoryEntry {
  source_file: string
  name: string
  description: string
  memory_type: string
  content: string
  content_hash: string
  scope: string
}

/**
 * Read all auto-memory files for a project from ~/.claude/projects/<project>/memory/
 */
export function readAutoMemory(cwd: string): MemoryEntry[] {
  const entries: MemoryEntry[] = []

  // Find the memory directory — Claude Code uses the encoded project path
  const claudeProjectsDir = resolve(homedir(), '.claude', 'projects')
  if (!existsSync(claudeProjectsDir)) return entries

  // Find the project directory that matches this cwd
  const memoryDir = findMemoryDir(cwd, claudeProjectsDir)
  if (!memoryDir || !existsSync(memoryDir)) return entries

  const files = readdirSync(memoryDir).filter(
    (f) => f.endsWith('.md') && f !== 'MEMORY.md'
  )

  for (const file of files) {
    try {
      const fullPath = resolve(memoryDir, file)
      const raw = readFileSync(fullPath, 'utf-8')

      // Parse frontmatter
      const { meta, body } = parseFrontmatter(raw)
      if (!meta.name || !meta.type || !body.trim()) continue

      // Scrub secrets from content
      const scrubbed = scrubSecrets(body).scrubbed

      // Hash for dedup
      const contentHash = createHash('sha256')
        .update(scrubbed)
        .digest('hex')
        .slice(0, 32)

      // Skip user-type memories (personal preferences, not team-relevant)
      const scope = meta.type === 'user' ? 'developer' : 'team'

      entries.push({
        source_file: file,
        name: meta.name,
        description: meta.description || '',
        memory_type: meta.type,
        content: scrubbed,
        content_hash: contentHash,
        scope,
      })
    } catch {
      // Skip unreadable files
    }
  }

  return entries
}

/**
 * Sync auto-memory entries to the hub.
 */
export async function syncMemoryToHub(
  entries: MemoryEntry[],
  projectHash: string,
  developerHash: string,
  hubConfig: { apiKey: string; url: string }
): Promise<{ synced: number; skipped: number }> {
  if (entries.length === 0) return { synced: 0, skipped: 0 }

  try {
    const res = await fetch(`${hubConfig.url}/api/v1/memory/sync`, {
      method: 'POST',
      headers: {
        'X-Clauditor-Key': hubConfig.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_hash: projectHash,
        developer_hash: developerHash,
        memories: entries,
      }),
    })

    if (!res.ok) return { synced: 0, skipped: entries.length }
    return res.json() as Promise<{ synced: number; skipped: number }>
  } catch {
    return { synced: 0, skipped: entries.length }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function findMemoryDir(cwd: string, claudeProjectsDir: string): string | null {
  // Claude Code encodes the project path as the directory name
  // Try to find a matching directory
  try {
    const dirs = readdirSync(claudeProjectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())

    for (const dir of dirs) {
      // The directory name is an encoded version of the project path
      // Check if this directory contains a memory/ subfolder
      const memPath = resolve(claudeProjectsDir, dir.name, 'memory')
      if (existsSync(memPath)) {
        // Check if this directory matches our cwd by decoding
        // Claude Code uses: cwd.replace(/[^a-zA-Z0-9]/g, '-')
        const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-')
        if (dir.name.includes(encoded.slice(0, 30)) || encoded.includes(dir.name.slice(0, 30))) {
          return memPath
        }
      }
    }

    // Fallback: try direct encoding
    const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 100)
    const directPath = resolve(claudeProjectsDir, encoded, 'memory')
    if (existsSync(directPath)) return directPath
  } catch {}

  return null
}

function parseFrontmatter(content: string): {
  meta: Record<string, string>
  body: string
} {
  const meta: Record<string, string> = {}
  const lines = content.split('\n')

  let inFrontmatter = false
  let bodyStart = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '---') {
      if (!inFrontmatter) {
        inFrontmatter = true
      } else {
        bodyStart = i + 1
        break
      }
    } else if (inFrontmatter && line.includes(':')) {
      const colonIdx = line.indexOf(':')
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      meta[key] = value
    }
  }

  return { meta, body: lines.slice(bodyStart).join('\n') }
}
