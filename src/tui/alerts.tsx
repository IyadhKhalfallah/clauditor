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

  // Quota burn rate — critical
  if (session.quotaBurnRate.burnRateStatus === 'critical') {
    const mins = session.quotaBurnRate.estimatedMinutesRemaining
    const timeStr = mins !== null ? `~${mins}min remaining` : 'unusually high burn rate'
    alerts.push({
      level: 'red',
      title: `Quota draining fast — ${timeStr}`,
      detail:
        `Burning ${(session.quotaBurnRate.tokensPerMinute / 1000).toFixed(0)}k weighted tokens/min. ` +
        'At this rate you\'ll hit your session limit very soon.',
      action: 'Check if cache is broken (look above). If so, run /clear. Consider starting a fresh session.',
    })
  } else if (session.quotaBurnRate.burnRateStatus === 'elevated') {
    const mins = session.quotaBurnRate.estimatedMinutesRemaining
    const timeStr = mins && mins >= 60 ? `~${(mins / 60).toFixed(1)}h` : `~${mins}min`
    alerts.push({
      level: 'yellow',
      title: `Elevated quota usage — ${timeStr} remaining at current rate`,
      detail:
        `Burning ${(session.quotaBurnRate.tokensPerMinute / 1000).toFixed(0)}k weighted tokens/min, which is higher than usual.`,
      action: 'Not urgent, but keep an eye on it. Large file reads and verbose bash output increase burn rate.',
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
      title: 'Cache efficiency is low — responses may be slower',
      detail: `Cache hit ratio is ${(session.cacheHealth.lastCacheRatio * 100).toFixed(0)}% (should be >70%). Claude is doing extra work each turn.`,
      action: 'Monitor the next few turns. If it doesn\'t improve, run /clear to reset.',
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
