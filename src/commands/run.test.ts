import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock child_process.spawn
const mockSpawn = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execSync: () => Buffer.from('/usr/bin/claude'),
}))

// Mock activity log — must return a thenable
vi.mock('../features/activity-log.js', () => ({
  logActivity: () => Promise.resolve(),
}))

import { runLoop } from './run.js'

function createChild(exitCode: number | null, signal: string | null) {
  const child = new EventEmitter()
  setTimeout(() => child.emit('exit', exitCode, signal), 0)
  return child
}

describe('runLoop', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
    vi.restoreAllMocks()
  })

  it('exits cleanly when claude exits with code 0', async () => {
    mockSpawn.mockReturnValue(createChild(0, null))
    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 0, restarts: 0, reason: 'normal_exit' })
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('stops on SIGINT (user Ctrl+C)', async () => {
    mockSpawn.mockReturnValue(createChild(null, 'SIGINT'))
    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 0, restarts: 0, reason: 'signal' })
  })

  it('stops on SIGTERM', async () => {
    mockSpawn.mockReturnValue(createChild(null, 'SIGTERM'))
    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 0, restarts: 0, reason: 'signal' })
  })

  it('restarts on exit code 2 (rotation block)', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 10000
      return now
    })

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      callCount++
      return createChild(callCount === 1 ? 2 : 0, null)
    })

    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 0, restarts: 1, reason: 'normal_exit' })
    expect(mockSpawn).toHaveBeenCalledTimes(2)
  })

  it('passes --task as -p flag only on first spawn', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 10000
      return now
    })

    let callCount = 0
    mockSpawn.mockImplementation(() => {
      callCount++
      return createChild(callCount === 1 ? 2 : 0, null)
    })

    await runLoop({ maxRestarts: 3, task: 'fix the bug' })

    expect(mockSpawn.mock.calls[0][1]).toEqual(['-p', 'fix the bug'])
    expect(mockSpawn.mock.calls[1][1]).toEqual([])
  })

  it('stops after max restarts reached', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 10000
      return now
    })

    mockSpawn.mockImplementation(() => createChild(2, null))

    const result = await runLoop({ maxRestarts: 2 })

    expect(result.reason).toBe('max_restarts')
    expect(result.restarts).toBe(3) // counter increments past limit before loop exits
    expect(mockSpawn).toHaveBeenCalledTimes(3) // 1 initial + 2 restarts
  })

  it('detects crash loop (exit <5s) and stops', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)

    mockSpawn.mockImplementation(() => createChild(2, null))

    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 1, restarts: 0, reason: 'crash_loop' })
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('handles spawn error gracefully', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child)
    setTimeout(() => child.emit('error', new Error('ENOENT')), 0)

    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 1, restarts: 0, reason: 'spawn_error' })
  })

  it('forwards non-2 exit code from claude', async () => {
    mockSpawn.mockReturnValue(createChild(130, null))

    const result = await runLoop({ maxRestarts: 3 })

    expect(result).toEqual({ exitCode: 130, restarts: 0, reason: 'normal_exit' })
  })
})
