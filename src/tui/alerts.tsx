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

  // Resume anomaly — token explosion on resume (#38029)
  if (session.resumeAnomaly.detected && session.resumeAnomaly.outputTokenSpike) {
    alerts.push({
      level: 'red',
      title: `Resume token explosion — ${(session.resumeAnomaly.outputTokenSpike / 1000).toFixed(0)}k output tokens in one turn`,
      detail:
        'This session generated an abnormal amount of output tokens after resume, likely without your input. ' +
        'This is a known bug that can drain your entire quota in minutes.',
      action: 'Start a fresh session instead of resuming. Avoid --resume and --continue flags until this is fixed upstream.',
    })
  }

  // Resume cache invalidation (#40524)
  if (session.resumeAnomaly.cacheInvalidatedAfterResume) {
    alerts.push({
      level: 'red',
      title: 'Resume broke cache — session is reprocessing everything',
      detail:
        'Resuming this session invalidated the prompt cache. Every turn now re-reads your full context from scratch ' +
        'instead of using cached tokens. This drains your quota 10-20x faster.',
      action: 'Start a fresh session. The --resume flag is known to cause cache invalidation in some versions.',
    })
  }

  // Quota burn rate — based on absolute rate, not time estimates
  // (Anthropic hasn't published quota mechanics, so we can't predict time remaining)
  if (session.quotaBurnRate.burnRateStatus === 'critical') {
    alerts.push({
      level: 'red',
      title: `Unusually high token consumption — ${(session.quotaBurnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min`,
      detail:
        'This session is consuming tokens much faster than normal. ' +
        'This usually means cache is broken (reprocessing everything) or there\'s a token generation bug.',
      action: 'Check if cache is broken (look above). If so, run /clear. If the problem persists, start a fresh session.',
    })
  } else if (session.quotaBurnRate.burnRateStatus === 'elevated') {
    alerts.push({
      level: 'yellow',
      title: `Above-average token consumption — ${(session.quotaBurnRate.tokensPerMinute / 1000).toFixed(0)}k tokens/min`,
      detail:
        'This session is consuming tokens faster than typical. Could be normal for complex tasks, or a sign of cache inefficiency.',
      action: 'Not urgent. Large file reads and verbose bash output increase consumption.',
    })
  }

  // Cache warming (expected on early turns)
  if (session.turns.length <= 2) {
    alerts.push({
      level: 'yellow',
      title: 'Cache warming up',
      detail: 'First few turns — cache is populating. Responses may be slower until turn 3-4.',
      action: 'No action needed. This is normal.',
    })
  }

  // Cache degradation
  if (session.cacheHealth.degradationDetected && !session.resumeAnomaly.cacheInvalidatedAfterResume) {
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
      title: 'Cache efficiency dipped — likely temporary',
      detail: `Cache hit ratio is ${(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}% (should be >70%). This often recovers on its own after a large file read or verbose output.`,
      action: 'No action needed yet. If it stays below 70% for 5+ turns, then consider running /clear.',
    })
  }

  // Loop detection
  if (session.loopState.loopDetected) {
    alerts.push({
      level: 'red',
      title: `Stuck in a loop — ${session.loopState.loopPattern || 'same action'} repeated ${session.loopState.consecutiveIdenticalTurns}x`,
      detail: 'Claude is trying the same thing and failing each time. It won\'t fix itself — you need to intervene.',
      action: 'Press Esc to stop, then rephrase what you need. Give Claude a different approach or break the task down.',
    })
  }

  // Context window — model-aware limits
  const lastTurn = session.turns[session.turns.length - 1]
  if (lastTurn) {
    const contextSize =
      lastTurn.usage.input_tokens +
      lastTurn.usage.cache_creation_input_tokens +
      lastTurn.usage.cache_read_input_tokens
    const isOpus = session.model?.includes('opus') ?? false
    const contextLimit = isOpus ? 1_000_000 : 200_000
    const pct = Math.round((contextSize / contextLimit) * 100)

    if (pct >= 100) {
      alerts.push({
        level: 'red',
        title: `Context full — compaction imminent (${pct}%)`,
        detail:
          'Claude will auto-compact soon, erasing older context. This causes "compaction amnesia" — ' +
          'Claude forgets decisions, file changes, and conventions from earlier in the session.',
        action: 'clauditor is instructing Claude to save session progress to CLAUDE.md before compaction. Start a fresh session after.',
      })
    } else if (pct >= 80) {
      alerts.push({
        level: 'yellow',
        title: `Context filling up — ${pct}% used`,
        detail:
          'This session is getting long. When it hits ~95%, clauditor will automatically instruct Claude to ' +
          'save key decisions to CLAUDE.md before compaction wipes them.',
        action: 'Good time to wrap up this task. Start a new session for the next task.',
      })
    }
  }

  return alerts
}
