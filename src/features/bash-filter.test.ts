import { describe, it, expect } from 'vitest'
import { compressBashOutput } from './bash-filter.js'

describe('compressBashOutput', () => {
  it('passes through short output unchanged', () => {
    const result = compressBashOutput('hello world')
    expect(result.compressed).toBe(false)
    expect(result.output).toBe('hello world')
  })

  it('compresses long output', () => {
    const longOutput = 'line\n'.repeat(500)
    const result = compressBashOutput(longOutput)
    expect(result.compressed).toBe(true)
    expect(result.compressedLength).toBeLessThan(result.originalLength)
    expect(result.output).toContain('[clauditor: output compressed')
  })

  it('collapses repeated lines', () => {
    const repeated = ('same line\n'.repeat(100)) + 'different line\n'
    const result = compressBashOutput(repeated)
    expect(result.compressed).toBe(true)
    expect(result.output).toContain('repeated')
  })

  it('summarizes npm install output', () => {
    const npmOutput =
      'npm install\n' +
      'npm warn deprecated foo@1.0.0\n'.repeat(50) +
      'added 42 packages in 3s\n' +
      '0 vulnerabilities\n'
    const result = compressBashOutput(npmOutput)
    expect(result.compressed).toBe(true)
    expect(result.output).toContain('added 42 packages')
  })

  it('removes progress bar lines', () => {
    const output =
      'Starting build...\n' +
      '[=====>          ] 30%\n'.repeat(20) +
      '[================] 100%\n' +
      'Build complete!\n' +
      'Some other content to make it long enough to trigger compression.\n'.repeat(20)
    const result = compressBashOutput(output)
    expect(result.output).not.toContain('[====')
  })

  it('respects maxOutputChars config', () => {
    const longOutput = 'a'.repeat(5000)
    const result = compressBashOutput(longOutput, { maxOutputChars: 1000 })
    // compressed output + clauditor footer
    expect(result.output.length).toBeLessThan(2000)
  })
})
