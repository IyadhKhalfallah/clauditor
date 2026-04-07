/**
 * Secret Scrubber — strips sensitive data before pushing to hub.
 *
 * Runs on every fragment before it leaves the local machine.
 * Replaces secrets with [REDACTED] to prevent leaking:
 * - API keys and tokens (Stripe, GitHub, OpenAI, Anthropic, AWS, etc.)
 * - Database connection strings with passwords
 * - Bearer/Basic auth headers
 * - Environment variable assignments with sensitive values
 * - Private keys and certificates
 * - JWT tokens
 *
 * Language-agnostic — works on any command output or error message.
 * Errs on the side of caution: better to redact a false positive
 * than to leak a real secret.
 */

// ─── Pattern Definitions ────────────────────────────────────

interface SecretPattern {
  name: string
  pattern: RegExp
  replacement: string
}

const SECRET_PATTERNS: SecretPattern[] = [
  // API keys by prefix (common providers)
  { name: 'stripe_key', pattern: /\b(sk_live_|pk_live_|sk_test_|pk_test_|rk_live_|rk_test_)[a-zA-Z0-9]{10,}/g, replacement: '[REDACTED_STRIPE_KEY]' },
  { name: 'github_pat', pattern: /\b(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[a-zA-Z0-9_]{10,}/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  { name: 'openai_key', pattern: /\bsk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED_OPENAI_KEY]' },
  { name: 'anthropic_key', pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { name: 'aws_key', pattern: /\b(AKIA|ASIA)[A-Z0-9]{12,}/g, replacement: '[REDACTED_AWS_KEY]' },
  { name: 'aws_secret', pattern: /\b[a-zA-Z0-9/+]{40}(?=\s|$|")/g, replacement: '[REDACTED_AWS_SECRET]' },
  { name: 'slack_token', pattern: /\bxox[bpars]-[a-zA-Z0-9-]{10,}/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  { name: 'npm_token', pattern: /\bnpm_[a-zA-Z0-9]{10,}/g, replacement: '[REDACTED_NPM_TOKEN]' },
  { name: 'heroku_key', pattern: /\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, replacement: '[REDACTED_UUID]' },
  { name: 'sendgrid_key', pattern: /\bSG\.[a-zA-Z0-9_-]{22,}\.[a-zA-Z0-9_-]{22,}/g, replacement: '[REDACTED_SENDGRID_KEY]' },
  { name: 'twilio_key', pattern: /\bSK[a-f0-9]{32}\b/g, replacement: '[REDACTED_TWILIO_KEY]' },
  { name: 'clerk_key', pattern: /\b(pk_live_|sk_live_|pk_test_|sk_test_)[a-zA-Z0-9]{10,}/g, replacement: '[REDACTED_CLERK_KEY]' },
  { name: 'supabase_key', pattern: /\beyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}/g, replacement: '[REDACTED_JWT]' },

  // Database connection strings with credentials — MUST come before env patterns
  { name: 'db_url_password', pattern: /:\/\/([^:]+):([^@]{3,})@/g, replacement: '://[user]:[REDACTED]@' },

  // Environment variable assignments pointing to connection strings
  { name: 'env_db_url', pattern: /(DATABASE_URL|REDIS_URL|MONGO_URI|DB_PASSWORD)\s*=\s*['"]?([^'"\s]{8,})['"]?/gi, replacement: '$1=[REDACTED]' },

  // Bearer and Basic auth in commands
  { name: 'bearer_token', pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/gi, replacement: 'Bearer [REDACTED]' },
  { name: 'basic_auth', pattern: /Basic\s+[a-zA-Z0-9+/=]{20,}/gi, replacement: 'Basic [REDACTED]' },
  { name: 'authorization_header', pattern: /Authorization:\s*['"]?[a-zA-Z0-9_\-.]{20,}['"]?/gi, replacement: 'Authorization: [REDACTED]' },

  // Environment variable assignments with likely secrets
  { name: 'env_secret', pattern: /((?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[_A-Z]*)\s*=\s*['"]?([^'"\s]{8,})['"]?/gi, replacement: '$1=[REDACTED]' },

  // Private keys (PEM format)
  { name: 'private_key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' },
  { name: 'certificate', pattern: /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/g, replacement: '[REDACTED_CERTIFICATE]' },

  // Generic long hex/base64 strings that look like secrets (40+ chars)
  // Only match when preceded by key-like context
  { name: 'generic_secret_value', pattern: /(?:key|token|secret|password|credential|auth)\s*[:=]\s*['"]?([a-zA-Z0-9/+_\-]{40,})['"]?/gi, replacement: '$<prefix>[REDACTED]' },
]

// Patterns that look like secrets but are actually safe
const FALSE_POSITIVE_PATTERNS = [
  /^[a-f0-9]{64}$/, // SHA-256 hashes (git commit hashes, file checksums)
  /^[a-f0-9]{40}$/, // SHA-1 hashes (git)
  /^[a-f0-9]{32}$/, // MD5 hashes
]

// ─── Scrubber ───────────────────────────────────────────────

/**
 * Scrub sensitive data from a string.
 * Returns the scrubbed string and the count of redactions made.
 */
export function scrubSecrets(text: string): { scrubbed: string; redactions: number } {
  let result = text
  let redactions = 0

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, (...args) => {
      redactions++
      return replacement
    })
  }

  return { scrubbed: result, redactions }
}

/**
 * Scrub secrets from a fragment's content before hub push.
 * Operates on all string values in the content object.
 */
export function scrubFragmentContent(
  content: Record<string, unknown>
): { content: Record<string, unknown>; redactions: number } {
  let totalRedactions = 0
  const scrubbed = { ...content }

  for (const key of Object.keys(scrubbed)) {
    const value = scrubbed[key]
    if (typeof value === 'string') {
      const result = scrubSecrets(value)
      scrubbed[key] = result.scrubbed
      totalRedactions += result.redactions
    }
  }

  return { content: scrubbed, redactions: totalRedactions }
}

/**
 * Scrub secrets from a handoff summary before hub push.
 */
export function scrubSummary(summary: string): string {
  return scrubSecrets(summary).scrubbed
}
