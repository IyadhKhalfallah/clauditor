import { SessionStore } from './store.js'
import { SessionWatcher, type WatcherOptions } from './watcher.js'
import type { AlertConfig } from '../types.js'
import {
  loadImpactStats,
  saveImpactStats,
  updateImpactFromSessions,
} from '../features/impact-tracker.js'
import { logActivity } from '../features/activity-log.js'

export interface DaemonOptions extends WatcherOptions {
  alerts?: Partial<AlertConfig>
}

export async function startDaemon(options: DaemonOptions = {}) {
  const store = new SessionStore()
  const watcher = new SessionWatcher(store, options)

  const desktopNotifications = options.alerts?.desktopNotifications ?? true

  if (desktopNotifications) {
    setupDesktopNotifications(store)
  }

  setupImpactTracking(store)

  await watcher.start()

  return { store, watcher }
}

/**
 * Send desktop notifications when cache degradation or loops are detected.
 * Tracks which sessions have already been alerted to avoid spam.
 */
function setupDesktopNotifications(store: SessionStore) {
  const alerted = new Set<string>()

  store.onUpdate((sessionId, state) => {
    const key = `${state.filePath}:${state.cacheHealth.status}`

    if (state.cacheHealth.degradationDetected && !alerted.has(key)) {
      alerted.add(key)
      sendNotification(
        'Cache Degradation Detected',
        `Session ${sessionId.slice(0, 8)} is reprocessing history as new tokens. ` +
          `Run /clear or start a fresh session.`
      )
      logActivity({
        type: 'notification',
        session: sessionId.slice(0, 8),
        message: `Desktop notification: cache degradation on ${state.label}`,
      }).catch(() => {})
    }

    const loopKey = `${state.filePath}:loop`
    if (state.loopState.loopDetected && !alerted.has(loopKey)) {
      alerted.add(loopKey)
      sendNotification(
        'Loop Detected',
        `Session ${sessionId.slice(0, 8)}: ${state.loopState.loopPattern || 'repeated tool calls'} ` +
          `(${state.loopState.consecutiveIdenticalTurns}x).`
      )
      logActivity({
        type: 'notification',
        session: sessionId.slice(0, 8),
        message: `Desktop notification: loop detected on ${state.label}`,
      }).catch(() => {})
    }
  })
}

/**
 * Periodically persist impact stats as sessions are monitored.
 * Debounced to avoid writing to disk on every single update.
 */
function setupImpactTracking(store: SessionStore) {
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  store.onUpdate(() => {
    if (saveTimer) return
    saveTimer = setTimeout(async () => {
      saveTimer = null
      try {
        const sessions = store.getAll()
        let stats = await loadImpactStats()
        stats = updateImpactFromSessions(stats, sessions)
        await saveImpactStats(stats)
      } catch {
        // Non-critical — stats will catch up next time
      }
    }, 10_000) // Save at most every 10 seconds
  })
}

async function sendNotification(title: string, message: string) {
  try {
    const notifier = await import('node-notifier')
    notifier.default.notify({
      title: `clauditor: ${title}`,
      message,
      sound: true,
    })
  } catch {
    // node-notifier may not be available on all platforms
  }
}
