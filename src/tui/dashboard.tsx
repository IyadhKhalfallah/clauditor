import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'
import { estimateCost, getPricingForModel } from '../features/cost-tracker.js'
import { loadCalibration } from '../features/calibration.js'

interface DashboardProps {
  session: SessionState
}

export function Dashboard({ session }: DashboardProps) {
  const pricing = session.model ? getPricingForModel(session.model) : undefined
  const cost = estimateCost(session.totalUsage, pricing)
  const modelShort = session.model?.replace('claude-', '').split('-2')[0] || 'unknown'

  // Calculate waste factor: current tokens/turn vs baseline (first 5 turns)
  const turnTokens = session.turns.map((t) =>
    t.usage.input_tokens + t.usage.output_tokens +
    t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens
  )

  const baseline = turnTokens.length >= 5
    ? turnTokens.slice(0, 5).reduce((a, b) => a + b, 0) / 5
    : turnTokens.length > 0
      ? turnTokens.slice(0, turnTokens.length).reduce((a, b) => a + b, 0) / turnTokens.length
      : 0

  const current = turnTokens.length >= 5
    ? turnTokens.slice(-5).reduce((a, b) => a + b, 0) / 5
    : baseline

  const wasteFactor = baseline > 0 ? Math.round(current / baseline) : 1
  const cal = loadCalibration()
  const willBlock = wasteFactor >= cal.wasteThreshold && session.turns.length >= cal.minTurns

  // Waste bar: 1x = empty, 10x = full (block threshold)
  const barWidth = 30
  const barPct = Math.min(1, (wasteFactor - 1) / (cal.wasteThreshold - 1)) // 1x=0%, threshold=100%
  const filled = Math.round(barPct * barWidth)
  const empty = barWidth - filled
  const wasteBar = '█'.repeat(filled) + '░'.repeat(empty)
  const warningZone = Math.round(cal.wasteThreshold * 0.7)
  const barColor = willBlock ? 'red' : wasteFactor >= warningZone ? 'yellow' : 'green'

  // Cache status
  const cacheRatio = session.cacheHealth.lastCacheRatio
  const cacheOk = cacheRatio >= 0.7

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text>
          <Text bold>{session.label}</Text>
          {'  '}
          <Text dimColor>{modelShort} · {session.turns.length} turns</Text>
        </Text>
      </Box>

      {/* Waste factor — the one number that matters */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold>Waste factor: {wasteFactor}x</Text>
          {'  '}
          {willBlock ? (
            <Text color="red" bold>BLOCKED — start a fresh session</Text>
          ) : wasteFactor >= 7 ? (
            <Text color="yellow">approaching rotation</Text>
          ) : (
            <Text color="green">efficient</Text>
          )}
        </Text>
        <Text color={barColor}>{wasteBar}</Text>
        <Text dimColor>
          Started at {(baseline / 1000).toFixed(0)}k/turn → now {(current / 1000).toFixed(0)}k/turn
          {wasteFactor > 1 ? ` (${wasteFactor}x more quota per turn)` : ''}
        </Text>
      </Box>

      {/* Secondary metrics — one line */}
      <Text>
        Cache: <Text color={cacheOk ? 'green' : 'red'}>{(cacheRatio * 100).toFixed(0)}%</Text>
        {'  '}
        Turns: {session.turns.length}
        {'  '}
        <Text dimColor>~${cost.totalCost.toFixed(0)} API est.</Text>
      </Text>

      {/* Alerts — only real problems, not warmup */}
      {!cacheOk && session.turns.length >= 10 && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ● Cache broken — {(cacheRatio * 100).toFixed(0)}% hit rate (should be &gt;70%)
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

      {/* How it works — transparency */}
      {session.turns.length < 10 && (
        <Box marginTop={1}>
          <Text dimColor>
            clauditor tracks tokens/turn as your session grows.{'\n'}
            At {cal.wasteThreshold}x waste ({cal.minTurns}+ turns), it saves context and blocks.{' '}
            {cal.confident ? '(auto-calibrated from your history)' : '(will auto-calibrate after more sessions)'}
          </Text>
        </Box>
      )}
    </Box>
  )
}
