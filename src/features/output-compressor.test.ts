import { describe, it, expect } from 'vitest'
import {
  compressToolOutput,
  compressGrepOutput,
  compressGlobOutput,
  compressWebFetchOutput,
  compressWebSearchOutput,
} from './output-compressor.js'

describe('compressToolOutput', () => {
  it('passes through unknown tools unchanged', () => {
    const result = compressToolOutput({
      toolName: 'UnknownTool',
      output: 'x'.repeat(10_000),
    })
    expect(result.compressed).toBe(false)
    expect(result.output.length).toBe(10_000)
  })

  it('routes Bash to the existing bash compressor', () => {
    const packageInstall = [
      'npm install',
      ...Array.from({ length: 200 }, (_, i) => `  [${i}/200] installing package-${i}`),
      'added 200 packages in 5s',
    ].join('\n')
    const result = compressToolOutput({ toolName: 'Bash', output: packageInstall })
    expect(result.compressed).toBe(true)
    expect(result.output.length).toBeLessThan(packageInstall.length)
  })
})

describe('compressGrepOutput', () => {
  it('passes through short output', () => {
    const output = 'src/foo.ts:10:const x = 1\nsrc/bar.ts:20:const y = 2'
    const result = compressGrepOutput(output, { output_mode: 'content' })
    expect(result.compressed).toBe(false)
  })

  it('passes through count and files_with_matches modes', () => {
    const output = Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`).join('\n')
    const countResult = compressGrepOutput(output, { output_mode: 'count' })
    const filesResult = compressGrepOutput(output, { output_mode: 'files_with_matches' })
    expect(countResult.compressed).toBe(false)
    expect(filesResult.compressed).toBe(false)
  })

  it('compresses many matches with a rollup', () => {
    const matches = Array.from({ length: 200 }, (_, i) => {
      const file = i < 100 ? 'src/big.ts' : `src/other-${i}.ts`
      return `${file}:${i + 1}:const foo = ${i}`
    })
    const output = matches.join('\n')
    const result = compressGrepOutput(output, { output_mode: 'content' })
    expect(result.compressed).toBe(true)
    expect(result.output.length).toBeLessThan(output.length)
    expect(result.output).toContain('additional matches')
    expect(result.output).toContain('src/big.ts:')
  })

  it('preserves head and tail matches', () => {
    const matches = Array.from({ length: 100 }, (_, i) => `src/file.ts:${i}:line ${i}`)
    const output = matches.join('\n')
    const result = compressGrepOutput(output, { output_mode: 'content' })
    expect(result.output).toContain('line 0')
    expect(result.output).toContain('line 99')
  })
})

describe('compressGlobOutput', () => {
  it('passes through short output', () => {
    const output = 'src/a.ts\nsrc/b.ts\nsrc/c.ts'
    const result = compressGlobOutput(output)
    expect(result.compressed).toBe(false)
  })

  it('groups the tail by directory on wide globs', () => {
    const paths = Array.from({ length: 100 }, (_, i) => {
      const dir = i < 40 ? 'src/components' : i < 80 ? 'src/utils' : 'test/unit'
      return `${dir}/file-${i}.ts`
    })
    const output = paths.join('\n')
    const result = compressGlobOutput(output)
    expect(result.compressed).toBe(true)
    expect(result.output).toContain('additional paths')
    expect(result.output).toMatch(/src\/(components|utils)\/:/)
  })
})

describe('compressWebFetchOutput', () => {
  it('passes through short content', () => {
    const output = 'Short fetched content'
    const result = compressWebFetchOutput(output)
    expect(result.compressed).toBe(false)
  })

  it('trims content above the 4000-char cap', () => {
    const output = 'x'.repeat(10_000)
    const result = compressWebFetchOutput(output)
    expect(result.compressed).toBe(true)
    expect(result.output.length).toBeLessThan(10_000)
    expect(result.output).toContain('clauditor')
  })
})

describe('compressWebSearchOutput', () => {
  it('passes through short output', () => {
    const output = 'Title\nhttps://example.com\nShort description'
    const result = compressWebSearchOutput(output)
    expect(result.compressed).toBe(false)
  })

  it('trims long marketing descriptions but keeps URLs', () => {
    const longDescription = 'This is a long marketing description. '.repeat(20)
    const output = [
      'Cool Product',
      'https://example.com/cool-product',
      longDescription,
      'Another Product',
      'https://example.com/another',
      longDescription,
    ].join('\n') + '\n' + 'x'.repeat(500)
    const result = compressWebSearchOutput(output)
    expect(result.compressed).toBe(true)
    expect(result.output).toContain('https://example.com/cool-product')
    expect(result.output).toContain('https://example.com/another')
    expect(result.output).toContain('clauditor: trimmed')
  })
})
