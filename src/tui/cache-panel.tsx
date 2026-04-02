import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'

interface CachePanelProps {
  session: SessionState
}

export function CachePanel({ session }: CachePanelProps) {
  const { turns, cacheHealth } = session

  return (
    <Box flexDirection="column">
      <Text bold underline>
        CACHE HEALTH
      </Text>
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        {turns.slice(-8).map((turn) => (
          <CacheBar
            key={turn.turnIndex}
            turnIndex={turn.turnIndex}
            ratio={turn.cacheRatio}
            totalTurns={turns.length}
          />
        ))}
        <Box marginTop={1}>
          <Text>
            Status:{' '}
            <StatusText status={cacheHealth.status} />
          </Text>
        </Box>
      </Box>
    </Box>
  )
}

function CacheBar({
  turnIndex,
  ratio,
  totalTurns,
}: {
  turnIndex: number
  ratio: number
  totalTurns: number
}) {
  const barWidth = 20
  const filled = Math.round(ratio * barWidth)
  const empty = barWidth - filled

  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const pct = `${Math.round(ratio * 100)}%`

  const label =
    turnIndex < 2
      ? '(warming up)'
      : ratio >= 0.7
        ? '✓'
        : ratio >= 0.4
          ? '~'
          : '✗'

  const color = ratio >= 0.7 ? 'green' : ratio >= 0.4 ? 'yellow' : 'red'

  return (
    <Text>
      Turn {String(turnIndex + 1).padStart(2)}:{' '}
      <Text color={color}>{bar}</Text>{' '}
      {pct.padStart(4)} {label}
    </Text>
  )
}

function StatusText({ status }: { status: string }) {
  switch (status) {
    case 'healthy':
      return <Text color="green">✓ healthy</Text>
    case 'degraded':
      return <Text color="yellow">⚠ degraded</Text>
    case 'broken':
      return <Text color="red">✗ broken — cache reprocessing detected</Text>
    default:
      return <Text dimColor>? warming up</Text>
  }
}
