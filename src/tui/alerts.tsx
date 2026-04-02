import React from 'react'
import { Box, Text } from 'ink'
import type { SessionState } from '../types.js'

interface AlertsProps {
  session: SessionState
}

interface Alert {
  level: 'red' | 'yellow' | 'green'
  title: string
  detail: string
  action: string
}

export function Alerts({ session }: AlertsProps) {
  const alerts = getAlerts(session)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold underline>
        ALERTS
      </Text>
      <Box flexDirection="column" paddingLeft={1} marginTop={1}>
        {alerts.length === 0 ? (
          <Text color="green">All clear — session is healthy.</Text>
        ) : (
          alerts.map((alert, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text color={alert.level} bold>
                {alert.level === 'red' ? '●' : '●'} {alert.title}
              </Text>
              <Text dimColor>  {alert.detail}</Text>
              <Text color="cyan">  → {alert.action}</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  )
}

function getAlerts(session: SessionState): Alert[] {
  const alerts: Alert[] = []

  // Cache warming (expected on early turns)
  if (session.turns.length <= 2) {
    alerts.push({
      level: 'yellow',
      title: 'Cache warming up',
      detail: 'First few turns — cache is populating. Responses may be slower until turn 3-4.',
      action: 'No action needed. This is normal.',
    })
  }

  // Cache degradation — framed as slowness, not cost
  if (session.cacheHealth.degradationDetected) {
    alerts.push({
      level: 'red',
      title: 'Session is slow — cache is broken',
      detail:
        `Cache hit ratio is ${(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}%. ` +
        `Claude is re-reading your entire conversation from scratch each turn instead of using cache. ` +
        `This makes every response significantly slower and wastes your rate limit.`,
      action: 'Run /clear in Claude Code to reset, then re-state what you\'re working on. Or start a fresh session.',
    })
  } else if (session.cacheHealth.status === 'degraded') {
    alerts.push({
      level: 'yellow',
      title: 'Cache efficiency is low — responses may be slower',
      detail: `Cache hit ratio is ${(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}% (should be >70%). Claude is doing extra work each turn.`,
      action: 'Monitor the next few turns. If it doesn\'t improve, run /clear to reset.',
    })
  }

  // Loop detection — framed as wasted time
  if (session.loopState.loopDetected) {
    alerts.push({
      level: 'red',
      title: `Stuck in a loop — ${session.loopState.loopPattern || 'same action'} repeated ${session.loopState.consecutiveIdenticalTurns}x`,
      detail: 'Claude is trying the same thing and failing each time. It won\'t fix itself — you need to intervene.',
      action: 'Press Esc to stop, then rephrase what you need. Give Claude a different approach or break the task down.',
    })
  }

  // Context window — framed as losing memory
  const lastTurn = session.turns[session.turns.length - 1]
  if (lastTurn) {
    const contextSize =
      lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    const pct = Math.round((contextSize / 200_000) * 100)

    if (pct >= 100) {
      alerts.push({
        level: 'red',
        title: `Context full — Claude is about to forget things (${pct}%)`,
        detail:
          'Auto-compaction will kick in soon. Claude will summarize and drop older context, ' +
          'which means it may lose track of decisions, file changes, or instructions from earlier in the session.',
        action: 'Start a fresh session now. If there\'s important context, tell Claude to save it to CLAUDE.md first.',
      })
    } else if (pct >= 80) {
      alerts.push({
        level: 'yellow',
        title: `Context filling up — ${pct}% used`,
        detail:
          'This session is getting long. Claude will auto-compact soon, which can cause it to ' +
          'lose track of earlier context and repeat work.',
        action: 'Good time to wrap up this task. Start a new session for the next task.',
      })
    }
  }

  return alerts
}
