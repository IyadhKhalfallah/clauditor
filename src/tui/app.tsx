import React, { useState, useEffect } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { SessionState } from '../types.js'
import { SessionStore } from '../daemon/store.js'
import { Dashboard } from './dashboard.js'
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
  const [activity, setActivity] = useState<ActivityEvent[]>([])

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit()
    }
  })

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
    const load = () => readActivity(3).then(setActivity).catch(() => {})
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  // Show the most recent main session (not subagent)
  const mainSessions = sessions.filter((s) => !s.sessionId.startsWith('agent-'))
  const activeSession = mainSessions[0] || sessions[0]

  // Recent sessions summary (last 12h to avoid timezone issues)
  const recentCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000)
  const recentSessions = sessions.filter((s) => s.lastUpdated >= recentCutoff)
  const recentMainCount = recentSessions.filter((s) => !s.sessionId.startsWith('agent-')).length
  const recentSubCount = recentSessions.filter((s) => s.sessionId.startsWith('agent-')).length

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ── clauditor ──
        </Text>
        <Text dimColor>  {recentMainCount} sessions + {recentSubCount} subagents (last 12h)</Text>
      </Box>

      {sessions.length === 0 ? (
        <Box>
          <Text dimColor>Waiting for active sessions...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {activeSession && <Dashboard session={activeSession} />}

          {/* Other recent main sessions — compact */}
          {mainSessions.length > 1 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold dimColor>OTHER SESSIONS</Text>
              {mainSessions.slice(1, 5).map((s) => {
                const avgTok = s.turns.length > 0
                  ? s.turns.slice(-10).reduce((sum, t) =>
                      sum + t.usage.input_tokens + t.usage.output_tokens +
                      t.usage.cache_creation_input_tokens + t.usage.cache_read_input_tokens, 0
                    ) / Math.min(10, s.turns.length)
                  : 0
                const statusIcon = s.cacheHealth.status === 'healthy' ? '✓'
                  : s.cacheHealth.status === 'degraded' ? '⚠' : '✗'

                return (
                  <Text key={s.filePath} dimColor>
                    {statusIcon} {s.label.slice(0, 35).padEnd(35)} {String(s.turns.length).padStart(4)} turns  {(avgTok / 1000).toFixed(0)}k/turn
                  </Text>
                )
              })}
            </Box>
          )}
        </Box>
      )}

      {/* Activity feed — only show if there are entries */}
      {activity.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>LAST ACTIONS</Text>
          {activity.map((event, i) => (
            <Text key={i} dimColor>
              {timeAgo(event.timestamp).padEnd(10)} {TYPE_ICONS[event.type] || '●'} {event.message}
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>q to quit · clauditor sessions for full history</Text>
      </Box>
    </Box>
  )
}
