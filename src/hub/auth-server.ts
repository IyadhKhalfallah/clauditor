/**
 * Localhost callback server for CLI authentication.
 *
 * Starts a temporary HTTP server on a random port, waits for the hub
 * to redirect the browser back with auth credentials. Same pattern
 * used by Railway CLI, Vercel CLI, and GitHub CLI.
 */

import { createServer, type Server } from 'node:http'
import { URL } from 'node:url'

export interface AuthResult {
  apiKey: string
  teamName: string
  teamId: string
  plan: string
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Start a localhost callback server and wait for auth credentials.
 * Returns a promise that resolves with the auth result, or rejects on timeout.
 */
export function waitForAuth(state: string): Promise<{ result: AuthResult; port: number }> {
  return new Promise((resolve, reject) => {
    let server: Server

    const timeout = setTimeout(() => {
      server?.close()
      reject(new Error('Authentication timed out after 5 minutes'))
    }, AUTH_TIMEOUT_MS)

    server = createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400)
        res.end('Bad request')
        return
      }

      const url = new URL(req.url, `http://localhost`)

      if (url.pathname !== '/callback') {
        res.writeHead(404)
        res.end('Not found')
        return
      }

      // Validate state parameter (prevents token interception)
      const returnedState = url.searchParams.get('state')
      if (returnedState !== state) {
        res.writeHead(403)
        res.end('Invalid state parameter')
        return
      }

      const apiKey = url.searchParams.get('api_key')
      const teamName = url.searchParams.get('team_name')
      const teamId = url.searchParams.get('team_id')
      const plan = url.searchParams.get('plan')

      if (!apiKey || !teamName || !teamId) {
        res.writeHead(400)
        res.end('Missing credentials')
        return
      }

      // Send branded success page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>clauditor — Connected</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #09090f;
      color: #ededf0;
    }
    .container {
      text-align: center;
      max-width: 420px;
      padding: 0 1.5rem;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 2rem;
    }
    .logo span { color: #f09040; }
    .card {
      padding: 2.5rem;
      background: #111118;
      border-radius: 1rem;
      border: 1px solid #1a1a2a;
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: rgba(240, 144, 64, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      font-size: 1.5rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    .team {
      color: #f09040;
      font-weight: 600;
    }
    .subtitle {
      color: #a0a0b8;
      font-size: 0.875rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .steps {
      text-align: left;
      background: #07070b;
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      font-size: 0.8rem;
      color: #a0a0b8;
      line-height: 1.7;
    }
    .steps .done {
      color: #4ade80;
    }
    .steps .next {
      color: #ededf0;
      font-weight: 500;
    }
    .footer {
      margin-top: 1.5rem;
      font-size: 0.75rem;
      color: #6b6b85;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"><span>clauditor</span></div>
    <div class="card">
      <div class="icon">&#x2713;</div>
      <h1>Connected to <span class="team">${teamName}</span></h1>
      <p class="subtitle">
        Your AI coding sessions will now share knowledge across your team.
        Return to your terminal to continue.
      </p>
      <div class="steps">
        <div class="done">&#x2713; Authenticated</div>
        <div class="done">&#x2713; Team connected</div>
        <div class="done">&#x2713; Knowledge sync enabled</div>
        <div class="next">&#x2192; Start a Claude Code session to begin</div>
      </div>
    </div>
    <p class="footer">You can close this tab.</p>
  </div>
</body>
</html>
      `)

      clearTimeout(timeout)

      // Close server after sending response
      setTimeout(() => {
        server.close()
        resolve({
          result: { apiKey, teamName, teamId, plan: plan || 'trial' },
          port: (server.address() as { port: number }).port,
        })
      }, 100)
    })

    // Listen on random port (port 0 = OS assigns)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      // Resolve with port so caller can build the auth URL
      // We hack this by storing port on a side channel
      ;(server as unknown as { _authPort: number })._authPort = addr.port
    })

    // Expose the port synchronously via a getter
    Object.defineProperty(server, 'authPort', {
      get: () => (server.address() as { port: number })?.port,
    })

    // Store server reference for port access
    ;(waitForAuth as unknown as { _server: Server })._server = server
  })
}

/**
 * Start the auth server and return the port immediately.
 * The returned promise resolves when auth completes.
 */
export async function startAuthServer(state: string): Promise<{
  port: number
  waitForResult: () => Promise<AuthResult>
}> {
  return new Promise((resolveStart) => {
    let resolveAuth: (result: AuthResult) => void
    let rejectAuth: (error: Error) => void

    const authPromise = new Promise<AuthResult>((res, rej) => {
      resolveAuth = res
      rejectAuth = rej
    })

    let server: Server

    const timeout = setTimeout(() => {
      server?.close()
      rejectAuth(new Error('Authentication timed out after 5 minutes'))
    }, AUTH_TIMEOUT_MS)

    server = createServer((req, res) => {
      if (!req.url) { res.writeHead(400); res.end(); return }

      const url = new URL(req.url, 'http://localhost')
      // CORS — allow the hub page to call localhost via fetch
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }

      const returnedState = url.searchParams.get('state')
      if (returnedState !== state) { res.writeHead(403); res.end('Invalid state'); return }

      const apiKey = url.searchParams.get('api_key')
      const teamName = url.searchParams.get('team_name')
      const teamId = url.searchParams.get('team_id')
      const plan = url.searchParams.get('plan')

      if (!apiKey || !teamName || !teamId) { res.writeHead(400); res.end(); return }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>clauditor — Connected</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#09090f;color:#ededf0}
.ctr{text-align:center;max-width:420px;padding:0 1.5rem}.logo{font-size:1.5rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:2rem}.logo span{color:#f09040}
.card{padding:2.5rem;background:#111118;border-radius:1rem;border:1px solid #1a1a2a}.icon{width:56px;height:56px;border-radius:16px;background:rgba(240,144,64,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 1.5rem;font-size:1.5rem;color:#f09040}
h1{font-size:1.25rem;font-weight:700;margin-bottom:0.5rem}.team{color:#f09040;font-weight:600}.sub{color:#a0a0b8;font-size:0.875rem;line-height:1.5;margin-bottom:1.5rem}
.steps{text-align:left;background:#07070b;border-radius:0.75rem;padding:1rem 1.25rem;font-size:0.8rem;color:#a0a0b8;line-height:1.7}.done{color:#4ade80}.next{color:#ededf0;font-weight:500}
.ft{margin-top:1.5rem;font-size:0.75rem;color:#6b6b85}</style>
</head><body><div class="ctr"><div class="logo"><span>clauditor</span></div><div class="card">
<div class="icon">&#x2713;</div>
<h1>Connected to <span class="team">${teamName}</span></h1>
<p class="sub">Your AI coding sessions will now share knowledge across your team. Return to your terminal to continue.</p>
<div class="steps"><div class="done">&#x2713; Authenticated</div><div class="done">&#x2713; Team connected</div><div class="done">&#x2713; Knowledge sync enabled</div><div class="next">&#x2192; Start a Claude Code session to begin</div></div>
</div><p class="ft">You can close this tab.</p></div></body></html>`)

      clearTimeout(timeout)
      setTimeout(() => {
        server.close()
        resolveAuth({ apiKey, teamName, teamId, plan: plan || 'trial' })
      }, 100)
    })

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolveStart({ port, waitForResult: () => authPromise })
    })
  })
}
