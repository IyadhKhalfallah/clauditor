import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Hook entry modules call their handler at module top level, so a static
// import of one runs a second handler in the importing process. Both then read
// stdin and print JSON: post-tool-use importing pre-tool-use produced `{}{…}`,
// which Claude Code rejects as invalid hook output.
const SRC = resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : []
  })
}

const files = sourceFiles(SRC)
const selfRunning = new Set(
  files.filter((f) => /^handle\w+Hook\(\)\.catch/m.test(readFileSync(f, 'utf-8')))
)

describe('hook entry modules', () => {
  it('finds the self-running hook modules', () => {
    expect(selfRunning.has(resolve(SRC, 'hooks/pre-tool-use.ts'))).toBe(true)
    expect(selfRunning.has(resolve(SRC, 'hooks/post-tool-use.ts'))).toBe(true)
  })

  it('are never statically imported by other modules', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(/^import\s[^;]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) {
        const target = resolve(dirname(file), m[1]).replace(/\.js$/, '.ts')
        if (selfRunning.has(target)) offenders.push(`${file.slice(SRC.length + 1)} -> ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
