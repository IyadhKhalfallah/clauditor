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
  const contextPct = Math.round((contextSize / 200_000) * 100)

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

      {/* Session metrics — framed around efficiency, not just cost */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          SESSION HEALTH
        </Text>
        <Box flexDirection="column" paddingLeft={1} marginTop={1}>
          <Text>
            Context window: <Text bold color={contextPct >= 90 ? 'red' : contextPct >= 70 ? 'yellow' : 'green'}>
              {contextPct}%
            </Text>
            {' '}
            <Text dimColor>({(contextSize / 1000).toFixed(0)}k / 200k tokens)</Text>
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
          <Text>
            Output: <Text bold>{session.totalUsage.output_tokens.toLocaleString()}</Text> tokens
            {'   '}
            <Text dimColor>{session.turns.length} turns this session</Text>
          </Text>
        </Box>
      </Box>

      {/* Cost section — secondary, collapsed */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold underline>
          USAGE
        </Text>
        <Box flexDirection="column" paddingLeft={1} marginTop={1}>
          <Text dimColor>
            Est. cost: ~${cost.totalCost.toFixed(2)}
            {'   '}
            Saved by cache: ~${cost.savedVsUncached.toFixed(2)}
          </Text>
        </Box>
      </Box>

      {/* Alerts */}
      <Alerts session={session} />
    </Box>
  )
}
