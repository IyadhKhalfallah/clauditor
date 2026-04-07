import { describe, it, expect } from 'vitest'
import { scrubSecrets, scrubFragmentContent, scrubSummary } from './secret-scrubber.js'

// Build test secrets at runtime to avoid GitHub push protection flagging them.
// These are NOT real secrets — they're constructed from safe fragments.
const FAKE_STRIPE = 'sk_live_' + 'TESTONLY00000000000000000'
const FAKE_GITHUB_PAT = 'github_pat_' + '11FAKE0000FAKE000000_0FakeTokenValueHereForTestingPurposesOnly00000000000000000000000'
const FAKE_GITHUB_GHP = 'ghp_' + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'
const FAKE_OPENAI = 'sk-' + 'proj-abc123def456ghi789jkl012mno345'
const FAKE_ANTHROPIC = 'sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz'
const FAKE_AWS = 'AKIA' + 'IOSFODNN7EXAMPLE'
const FAKE_SLACK = 'xoxb-' + '0000000000-fakefakefakefa'
const FAKE_NPM = 'npm_' + 'abcdefghijklmnop'
const FAKE_CLERK = 'sk_live_' + 'TESTONLY00000000000000000000000000000000000'
const FAKE_SENDGRID = 'SG.' + 'abcdefghijklmnopqrstuv.wxyzABCDEFGHIJKLMNOPQR'
const FAKE_DB_PASS = 'fAkEpAsSwOrD123456xY'

describe('scrubSecrets', () => {
  // ─── API Keys ──────────────────────────────────────────────

  it('redacts Stripe keys', () => {
    const { scrubbed } = scrubSecrets(`STRIPE_KEY=${FAKE_STRIPE}`)
    expect(scrubbed).not.toContain('TESTONLY')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts GitHub PATs', () => {
    const { scrubbed } = scrubSecrets(`token: ${FAKE_GITHUB_PAT}`)
    expect(scrubbed).not.toContain('FAKE0000')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts GitHub tokens (ghp_)', () => {
    const { scrubbed } = scrubSecrets(`git push https://${FAKE_GITHUB_GHP}@github.com/user/repo.git`)
    expect(scrubbed).not.toContain('ABCDEF')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts OpenAI keys', () => {
    const { scrubbed } = scrubSecrets(`OPENAI_API_KEY=${FAKE_OPENAI}`)
    expect(scrubbed).not.toContain('proj-abc')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts Anthropic keys', () => {
    const { scrubbed } = scrubSecrets(`ANTHROPIC_API_KEY=${FAKE_ANTHROPIC}`)
    expect(scrubbed).not.toContain('api03-abc')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts AWS access keys', () => {
    const { scrubbed } = scrubSecrets(`AWS_ACCESS_KEY_ID=${FAKE_AWS}`)
    expect(scrubbed).not.toContain('IOSFODNN')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts Slack tokens', () => {
    const { scrubbed } = scrubSecrets(`SLACK_TOKEN=${FAKE_SLACK}`)
    expect(scrubbed).not.toContain('fakefake')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts npm tokens', () => {
    const { scrubbed } = scrubSecrets(`//registry.npmjs.org/:_authToken=${FAKE_NPM}`)
    expect(scrubbed).not.toContain('abcdef')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts Clerk keys', () => {
    const { scrubbed } = scrubSecrets(`CLERK_SECRET_KEY=${FAKE_CLERK}`)
    expect(scrubbed).not.toContain('TESTONLY')
    expect(scrubbed).toContain('[REDACTED')
  })

  it('redacts SendGrid keys', () => {
    const { scrubbed } = scrubSecrets(`SENDGRID_API_KEY=${FAKE_SENDGRID}`)
    expect(scrubbed).not.toContain('abcdef')
    expect(scrubbed).toContain('[REDACTED')
  })

  // ─── Database URLs ─────────────────────────────────────────

  it('redacts database passwords in connection strings', () => {
    const { scrubbed } = scrubSecrets(`postgresql://postgres:${FAKE_DB_PASS}@db.example.com:5432/mydb`)
    expect(scrubbed).not.toContain(FAKE_DB_PASS)
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('redacts MongoDB connection strings', () => {
    const { scrubbed } = scrubSecrets('mongodb://admin:s3cur3P@ss!@cluster0.mongodb.net/mydb')
    expect(scrubbed).not.toContain('s3cur3P@ss!')
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('redacts Redis URLs', () => {
    const { scrubbed } = scrubSecrets('redis://default:mypassword123@redis-12345.c1.us-east-1-2.ec2.cloud.redislabs.com:12345')
    expect(scrubbed).not.toContain('mypassword123')
    expect(scrubbed).toContain('[REDACTED]')
  })

  // ─── Auth Headers ──────────────────────────────────────────

  it('redacts Bearer tokens in curl commands', () => {
    const { scrubbed } = scrubSecrets('curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0"')
    expect(scrubbed).not.toContain('eyJhbGci')
    expect(scrubbed).toContain('Bearer [REDACTED]')
  })

  it('redacts Basic auth', () => {
    const { scrubbed } = scrubSecrets('Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM0NTY3ODk=')
    expect(scrubbed).not.toContain('dXNlcm5hbWU6')
    expect(scrubbed).toContain('Basic [REDACTED]')
  })

  // ─── Environment Variables ─────────────────────────────────

  it('redacts SECRET_KEY assignments', () => {
    const { scrubbed } = scrubSecrets('SECRET_KEY=my-super-secret-value-that-should-not-leak')
    expect(scrubbed).not.toContain('my-super-secret')
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('redacts TOKEN assignments', () => {
    const { scrubbed } = scrubSecrets('AUTH_TOKEN="abc123def456ghi789"')
    expect(scrubbed).not.toContain('abc123def')
    expect(scrubbed).toContain('[REDACTED]')
  })

  it('redacts DATABASE_URL assignments', () => {
    const { scrubbed } = scrubSecrets('DATABASE_URL=postgresql://user:pass@host/db')
    expect(scrubbed).not.toContain('pass@host')
  })

  it('redacts PASSWORD assignments', () => {
    const { scrubbed } = scrubSecrets('DB_PASSWORD=hunter2hunter2')
    expect(scrubbed).not.toContain('hunter2')
    expect(scrubbed).toContain('[REDACTED]')
  })

  // ─── Private Keys ──────────────────────────────────────────

  it('redacts PEM private keys', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'
    const { scrubbed } = scrubSecrets(pem)
    expect(scrubbed).not.toContain('MIIEvg')
    expect(scrubbed).toContain('[REDACTED_PRIVATE_KEY]')
  })

  it('redacts RSA private keys', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    const { scrubbed } = scrubSecrets(pem)
    expect(scrubbed).not.toContain('MIIEpAI')
    expect(scrubbed).toContain('[REDACTED_PRIVATE_KEY]')
  })

  // ─── JWTs ──────────────────────────────────────────────────

  it('redacts JWT tokens', () => {
    const { scrubbed } = scrubSecrets('token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ')
    expect(scrubbed).not.toContain('eyJhbGci')
    expect(scrubbed).toContain('[REDACTED')
  })

  // ─── Safe Content ──────────────────────────────────────────

  it('does NOT redact normal error messages', () => {
    const msg = 'Error: Module not found: Cannot resolve @/lib/db from src/app/page.tsx'
    const { scrubbed } = scrubSecrets(msg)
    expect(scrubbed).toBe(msg)
  })

  it('does NOT redact normal commands', () => {
    const cmd = 'npm run build && npm test -- --watch'
    const { scrubbed } = scrubSecrets(cmd)
    expect(scrubbed).toBe(cmd)
  })

  it('does NOT redact git commit messages', () => {
    const msg = 'git commit -m "feat: add authentication flow"'
    const { scrubbed } = scrubSecrets(msg)
    expect(scrubbed).toBe(msg)
  })

  it('does NOT redact file paths', () => {
    const path = '/Users/dev/project/src/features/error-index.ts'
    const { scrubbed } = scrubSecrets(path)
    expect(scrubbed).toBe(path)
  })

  it('does NOT redact URLs without credentials', () => {
    const url = 'https://www.clauditor.ai/api/v1/knowledge/push'
    const { scrubbed } = scrubSecrets(url)
    expect(scrubbed).toBe(url)
  })

  // ─── Redaction Count ───────────────────────────────────────

  it('counts redactions', () => {
    const { redactions } = scrubSecrets('Using sk_live_abc123def456ghi789 and ghp_XYZ789abc012def345ghi')
    expect(redactions).toBeGreaterThanOrEqual(2)
  })

  // ─── Real-World Scenarios ──────────────────────────────────

  it('scrubs a real curl command with auth', () => {
    const cmd = `curl -s -X POST "https://api.github.com/repos/user/repo/pulls" -H "Authorization: token ${FAKE_GITHUB_PAT}"`
    const { scrubbed } = scrubSecrets(cmd)
    expect(scrubbed).not.toContain('FAKE0000')
    expect(scrubbed).toContain('https://api.github.com')
  })

  it('scrubs a real git push with PAT', () => {
    const cmd = `git push https://${FAKE_GITHUB_PAT}@github.com/user/repo.git main`
    const { scrubbed } = scrubSecrets(cmd)
    expect(scrubbed).not.toContain('FAKE0000')
    expect(scrubbed).toContain('github.com/user/repo.git')
  })

  it('scrubs a DATABASE_URL in command', () => {
    const cmd = `DATABASE_URL="postgresql://postgres:${FAKE_DB_PASS}@db.example.com:5432/mydb" npx drizzle-kit push`
    const { scrubbed } = scrubSecrets(cmd)
    expect(scrubbed).not.toContain(FAKE_DB_PASS)
    expect(scrubbed).toContain('drizzle-kit push')
  })

  it('scrubs error output containing leaked tokens', () => {
    const error = `Error: Invalid token ${FAKE_GITHUB_PAT}`
    const { scrubbed } = scrubSecrets(error)
    expect(scrubbed).not.toContain('FAKE0000')
    expect(scrubbed).toContain('Error:')
  })
})

describe('scrubFragmentContent', () => {
  it('scrubs all string values in a fragment', () => {
    const { content, redactions } = scrubFragmentContent({
      command: `postgresql://user:${FAKE_DB_PASS}@host/db npm run build`,
      error_message: `Connection failed with token ${FAKE_STRIPE}`,
    })
    expect(content.command).not.toContain(FAKE_DB_PASS)
    expect((content.error_message as string)).not.toContain('TESTONLY')
    expect(redactions).toBeGreaterThanOrEqual(2)
  })

  it('preserves non-string values', () => {
    const { content } = scrubFragmentContent({
      command: 'npm test',
      exit_code: 1,
      success: false,
    })
    expect(content.exit_code).toBe(1)
    expect(content.success).toBe(false)
  })
})

describe('scrubSummary', () => {
  it('scrubs a handoff summary containing secrets', () => {
    const summary = `
TASK: Deploy to production

DEPENDENCIES:
- DATABASE_URL=postgresql://postgres:${FAKE_DB_PASS}@host/db
- Use PAT: ${FAKE_GITHUB_PAT}
- Stripe key: ${FAKE_STRIPE}

COMPLETED:
- Deployed successfully
`
    const scrubbed = scrubSummary(summary)
    expect(scrubbed).not.toContain(FAKE_DB_PASS)
    expect(scrubbed).not.toContain('FAKE0000')
    expect(scrubbed).not.toContain('TESTONLY')
    expect(scrubbed).toContain('TASK: Deploy to production')
    expect(scrubbed).toContain('Deployed successfully')
  })
})
