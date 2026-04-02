import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'

interface SessionListProps {
  sessions: SessionState[]
  selectedId: string | null
  onSelect: (filePath: string) => void
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function SessionList({ sessions, selectedId }: SessionListProps) {
  if (sessions.length <= 1) return null

  // Show at most 15 sessions to keep the list manageable
  const visible = sessions.slice(0, 15)
  const hidden = sessions.length - visible.length

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold underline>
        RECENT SESSIONS ({sessions.length})
      </Text>
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        {visible.map((session) => {
          const isSelected = session.filePath === selectedId
          const statusColor =
            session.cacheHealth.status === 'healthy'
              ? 'green'
              : session.cacheHealth.status === 'broken'
                ? 'red'
                : session.cacheHealth.status === 'degraded'
                  ? 'yellow'
                  : undefined

          return (
            <Text key={session.filePath}>
              {isSelected ? '▸ ' : '  '}
              <Text bold={isSelected}>
                {session.label.slice(0, 30).padEnd(30)}
              </Text>
              {'  '}
              <Text color={statusColor}>
                {session.cacheHealth.status.padEnd(8)}
              </Text>
              {'  '}
              <Text dimColor>
                {String(session.turns.length).padStart(4)} turns
              </Text>
              {'  '}
              <Text dimColor>
                {timeAgo(session.lastUpdated)}
              </Text>
            </Text>
          )
        })}
        {hidden > 0 && (
          <Text dimColor>  ... and {hidden} more</Text>
        )}
      </Box>
    </Box>
  )
}
