import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'
import { SessionStore } from '../daemon/store.js'
import { Dashboard } from './dashboard.js'
import { SessionList } from './session-list.js'

interface AppProps {
  store: SessionStore
  projectPath?: string
}

/**
 * Filter to only recent sessions (last 24h) and exclude subagent
 * transcripts unless they have issues. Sort by most recent first.
 */
function filterAndSortSessions(sessions: SessionState[]): SessionState[] {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  return sessions
    .filter((s) => {
      // Always show sessions with issues
      if (s.cacheHealth.status === 'broken' || s.loopState.loopDetected) return true
      // Show recent sessions
      return s.lastUpdated >= oneDayAgo
    })
    .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
}

export function App({ store, projectPath }: AppProps) {
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => {
      const allSessions = projectPath
        ? store.getByProject(projectPath)
        : store.getAll()
      setSessions(filterAndSortSessions(allSessions))
    }

    refresh()

    const unsubscribe = store.onUpdate(refresh)
    return unsubscribe
  }, [store, projectPath])

  // Default to the most recently updated session (first in sorted list)
  const activeSession = selectedSession
    ? sessions.find((s) => s.filePath === selectedSession)
    : sessions[0]

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ── clauditor ──
        </Text>
      </Box>

      {sessions.length === 0 ? (
        <Box>
          <Text dimColor>Waiting for active sessions...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <SessionList
            sessions={sessions}
            selectedId={activeSession?.sessionId ?? null}
            onSelect={setSelectedSession}
          />
          {activeSession && <Dashboard session={activeSession} />}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press q to quit</Text>
      </Box>
    </Box>
  )
}
