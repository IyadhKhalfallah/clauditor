/**
 * Provider registry — central lookup for all registered AI tool providers.
 *
 * Providers register themselves at import time. The registry supports:
 * - Explicit lookup by name (e.g. --provider codex)
 * - Auto-detection of installed tools
 * - Matching a session file path to its provider
 */

import { existsSync } from 'node:fs'
import type { Provider } from './types.js'

export class ProviderRegistry {
  private providers = new Map<string, Provider>()

  /** Register a provider. Overwrites if name already exists. */
  register(provider: Provider): void {
    this.providers.set(provider.name, provider)
  }

  /** Get a provider by name. Throws if not found. */
  get(name: string): Provider {
    const provider = this.providers.get(name)
    if (!provider) {
      const available = [...this.providers.keys()].join(', ')
      throw new Error(`Unknown provider "${name}". Available: ${available}`)
    }
    return provider
  }

  /** Get a provider by name, or null if not found. */
  find(name: string): Provider | null {
    return this.providers.get(name) ?? null
  }

  /** Get all registered providers. */
  getAll(): Provider[] {
    return [...this.providers.values()]
  }

  /** Get all provider names. */
  names(): string[] {
    return [...this.providers.keys()]
  }

  /**
   * Auto-detect which providers are installed by checking if their
   * config/session directories exist on this machine.
   */
  detect(): Provider[] {
    return this.getAll().filter((p) => {
      try {
        return existsSync(p.directories.configDir())
      } catch {
        return false
      }
    })
  }

  /**
   * Find the provider that owns a given session file path.
   * Checks if the file path starts with the provider's sessions directory.
   */
  forSessionFile(filePath: string): Provider | null {
    for (const provider of this.providers.values()) {
      const sessDir = provider.directories.sessionsDir()
      if (filePath.startsWith(sessDir)) {
        return provider
      }
    }
    return null
  }
}

/** Singleton registry instance — providers register on import. */
export const registry = new ProviderRegistry()
