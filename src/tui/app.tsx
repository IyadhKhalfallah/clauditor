import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { SessionState } from '../types.js'
import { SessionStore } from '../daemon/store.js'
import { Dashboard } from './dashboard.js'
import { SessionList } from './session-list.js'
import { readActivity, type ActivityEvent } from '../features/activity-log.js'

interface AppProps {
  store: SessionStore
  projectPath?: string
}

function filterAndSortSessions(sessions: SessionState[]): SessionState[] {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  return sessions
    .filter((s) => {
      if (s.cacheHealth.status === 'broken' || s.loopState.loopDetected) return true
      return s.lastUpdated >= oneDayAgo
    })
    .sort((a, b) => b.lastUpdated.getTime() - a.lastUpdated.getTime())
}

function timeAgo(timestamp: string): string {
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const TYPE_ICONS: Record<string, string> = {
  cache_warning: '⚡',
  loop_blocked: '🛑',
  resume_warning: '⚠',
  context_warning: '📦',
  bash_compressed: '📦',
  notification: '🔔',
  burn_rate_warning: '📈',
}

export function App({ store, projectPath }: AppProps) {
  const { exit } = useApp()
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit()
    }
  })

  // Clear terminal on mount to prevent stacked frames
  useEffect(() => {
    process.stdout.write('\x1B[2J\x1B[H')
  }, [])

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

  // Poll activity log every 5 seconds
  useEffect(() => {
    const load = () => readActivity(5).then(setActivity).catch(() => {})
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

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

      {/* Activity feed — show recent actions */}
      {activity.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold underline>RECENT ACTIVITY</Text>
          <Box flexDirection="column" paddingLeft={1} marginTop={1}>
            {activity.map((event, i) => (
              <Text key={i} dimColor>
                {timeAgo(event.timestamp).padEnd(10)} {TYPE_ICONS[event.type] || '●'} {event.message}
              </Text>
            ))}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press q to quit</Text>
      </Box>
    </Box>
  )
}
