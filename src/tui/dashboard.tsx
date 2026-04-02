import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'
import { CachePanel } from './cache-panel.js'
import { Alerts } from './alerts.js'
import { estimateCost, getPricingForModel } from '../features/cost-tracker.js'

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

  // Compute context window usage from last turn
  const lastTurn = session.turns[session.turns.length - 1]
  const contextSize = lastTurn
    ? lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    : 0
  // Context window varies by model: Opus 4.6 supports up to 1M with extended context
  const isOpus = session.model?.includes('opus') ?? false
  const contextLimit = isOpus ? 1_000_000 : 200_000
  const contextLimitLabel = isOpus ? '1M' : '200k'
  const contextPct = Math.round((contextSize / contextLimit) * 100)

  // Compute avg tokens per turn (last 10 turns for recent picture)
  const recentTurns = session.turns.slice(-10)
  const avgTokensPerTurn = recentTurns.length > 0
    ? recentTurns.reduce((sum, t) =>
        sum + t.usage.input_tokens + t.usage.output_tokens +
        t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens, 0
      ) / recentTurns.length
    : 0
  const rotationThreshold = 100_000
  const rotationPct = Math.round((avgTokensPerTurn / rotationThreshold) * 100)
  const willRotate = avgTokensPerTurn >= rotationThreshold && session.turns.length >= 30

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold>{session.label}</Text>
          {'  '}
          <Text dimColor>{modelShort}</Text>
          {'  '}
          <Text dimColor>{session.turns.length} turns</Text>
        </Text>
        <Text dimColor>{displayPath}</Text>
      </Box>

      {/* Cache Health */}
      <CachePanel session={session} />

      {/* Session metrics */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          SESSION HEALTH
        </Text>
        <Box flexDirection="column" paddingLeft={1} marginTop={1}>
          <Text>
            Tokens/turn: <Text bold color={willRotate ? 'red' : rotationPct >= 70 ? 'yellow' : 'green'}>
              {(avgTokensPerTurn / 1000).toFixed(0)}k
            </Text>
            {' '}
            <Text dimColor>
              {willRotate
                ? '(rotation triggered — Claude will save context + suggest fresh start)'
                : rotationPct >= 70
                  ? `(${rotationPct}% to rotation threshold)`
                  : '(efficient)'}
            </Text>
          </Text>
          <Text>
            Context window: <Text bold color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'green'}>
              {contextPct}%
            </Text>
            {' '}
            <Text dimColor>({(contextSize / 1000).toFixed(0)}k / {contextLimitLabel} tokens)</Text>
          </Text>
          <Text>
            Cache efficiency: <Text bold color={session.cacheHealth.lastCacheRatio >= 0.7 ? 'green' : session.cacheHealth.lastCacheRatio >= 0.4 ? 'yellow' : 'red'}>
              {(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}%
            </Text>
            {' '}
            <Text dimColor>
              {session.cacheHealth.lastCacheRatio >= 0.7
                ? '(fast responses)'
                : session.cacheHealth.lastCacheRatio >= 0.4
                  ? '(slower than normal)'
                  : '(reprocessing — slow)'}
            </Text>
          </Text>
          {session.quotaBurnRate.tokensPerMinute > 0 && (
            <Text>
              Burn rate: <Text bold color={session.quotaBurnRate.burnRateStatus === 'critical' ? 'red' : session.quotaBurnRate.burnRateStatus === 'elevated' ? 'yellow' : 'green'}>
                {(session.quotaBurnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min
              </Text>
              {' '}
              <Text dimColor>
                {session.quotaBurnRate.burnRateStatus === 'critical'
                  ? '(unusually high)'
                  : session.quotaBurnRate.burnRateStatus === 'elevated'
                    ? '(above average)'
                    : '(normal)'}
              </Text>
            </Text>
          )}
          {session.resumeAnomaly.resumeDetected && (
            <Text>
              Session: <Text color={session.resumeAnomaly.detected ? 'red' : 'yellow'}>
                {session.resumeAnomaly.detected ? 'resumed (anomaly detected)' : 'resumed'}
              </Text>
            </Text>
          )}
          <Text>
            Output: <Text bold>{session.totalUsage.output_tokens.toLocaleString()}</Text> tokens
            {'   '}
            <Text dimColor>{session.turns.length} turns this session</Text>
          </Text>
        </Box>
      </Box>

      {/* Cost section — only relevant for API users */}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>
          API cost estimate: ~${cost.totalCost.toFixed(2)} · saved ~${cost.savedVsUncached.toFixed(2)} by cache
        </Text>
      </Box>

      {/* Alerts */}
      <Alerts session={session} />
    </Box>
  )
}
