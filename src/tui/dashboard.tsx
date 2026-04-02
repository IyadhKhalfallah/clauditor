import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'
import { CachePanel } from './cache-panel.js'
import { estimateCost, getPricingForModel } from '../features/cost-tracker.js'
import { readActivity, type ActivityEvent } from '../features/activity-log.js'

interface DashboardProps {
  session: SessionState
}

function decodeProjectPath(encoded: string): string {
  if (encoded.startsWith('-')) {
    return '/' + encoded.slice(1).replace(/-/g, '/')
  }
  return encoded.replace(/-/g, '/')
}

export function Dashboard({ session }: DashboardProps) {
  const pricing = session.model ? getPricingForModel(session.model) : undefined
  const cost = estimateCost(session.totalUsage, pricing)
  const displayPath = session.cwd || decodeProjectPath(session.projectPath)
  const modelShort = session.model?.replace('claude-', '').split('-2')[0] || 'unknown'

  const lastTurn = session.turns[session.turns.length - 1]
  const contextSize = lastTurn
    ? lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    : 0
  const isOpus = session.model?.includes('opus') ?? false
  const contextLimit = isOpus ? 1_000_000 : 200_000
  const contextLimitLabel = isOpus ? '1M' : '200k'
  const contextPct = Math.round((contextSize / contextLimit) * 100)

  // Avg tokens per turn (last 10)
  const recentTurns = session.turns.slice(-10)
  const avgTokensPerTurn = recentTurns.length > 0
    ? recentTurns.reduce((sum, t) =>
        sum + t.usage.input_tokens + t.usage.output_tokens +
        t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens, 0
      ) / recentTurns.length
    : 0
  const rotationThreshold = 100_000
  const rotationPct = Math.min(100, Math.round((avgTokensPerTurn / rotationThreshold) * 100))
  const willRotate = avgTokensPerTurn >= rotationThreshold && session.turns.length >= 30

  // Rotation progress bar
  const barWidth = 30
  const filled = Math.round((rotationPct / 100) * barWidth)
  const empty = barWidth - filled
  const rotationBar = '█'.repeat(filled) + '░'.repeat(empty)
  const rotationColor = willRotate ? 'red' : rotationPct >= 70 ? 'yellow' : 'green'

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold>{session.label}</Text>
          {'  '}
          <Text dimColor>{modelShort} · {session.turns.length} turns</Text>
        </Text>
        <Text dimColor>{displayPath}</Text>
      </Box>

      {/* The one number that matters: tokens per turn → rotation threshold */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold>{(avgTokensPerTurn / 1000).toFixed(0)}k</Text> tokens/turn
          {'  '}
          {willRotate ? (
            <Text color="red" bold>ROTATION TRIGGERED — context saved to CLAUDE.md</Text>
          ) : (
            <Text dimColor>{rotationPct}% to rotation</Text>
          )}
        </Text>
        <Text color={rotationColor}>
          {rotationBar}
        </Text>
        {willRotate && (
          <Text color="cyan">→ Start a fresh session with `claude` to use {Math.round(avgTokensPerTurn / 10000)}x less quota per turn</Text>
        )}
      </Box>

      {/* Key metrics — one line each */}
      <Box flexDirection="column">
        <Text>
          Cache: <Text color={session.cacheHealth.lastCacheRatio >= 0.7 ? 'green' : 'red'}>
            {(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}%
          </Text>
          {'  '}
          Context: <Text color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'green'}>
            {contextPct}%
          </Text>
          <Text dimColor> ({(contextSize / 1000).toFixed(0)}k / {contextLimitLabel})</Text>
          {'  '}
          <Text dimColor>~${cost.totalCost.toFixed(0)} API est.</Text>
        </Text>
      </Box>

      {/* Alerts — only show if something is actually wrong */}
      {session.cacheHealth.status !== 'healthy' && session.cacheHealth.status !== 'unknown' && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ● Cache {session.cacheHealth.status} — {(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}% hit rate
          </Text>
        </Box>
      )}
      {session.loopState.loopDetected && (
        <Box>
          <Text color="red" bold>
            ● Loop — {session.loopState.loopPattern} repeated {session.loopState.consecutiveIdenticalTurns}x
          </Text>
        </Box>
      )}
      {session.resumeAnomaly.detected && (
        <Box>
          <Text color="red" bold>
            ● Resume anomaly — {session.resumeAnomaly.outputTokenSpike ? 'token explosion' : 'cache invalidated'}
          </Text>
        </Box>
      )}
    </Box>
  )
}
