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

      // Send success page to the browser
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>clauditor — logged in</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0d0d14;
      color: #e8e8f0;
    }
    .card {
      text-align: center;
      padding: 3rem;
      background: #181828;
      border-radius: 1rem;
      border: 1px solid #2a2a42;
    }
    .check { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { color: #9898b0; font-size: 0.875rem; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Logged in to ${teamName}</h1>
    <p>You can close this tab and return to your terminal.</p>
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
      if (url.pathname !== '/callback') { res.writeHead(404); res.end(); return }

      const returnedState = url.searchParams.get('state')
      if (returnedState !== state) { res.writeHead(403); res.end('Invalid state'); return }

      const apiKey = url.searchParams.get('api_key')
      const teamName = url.searchParams.get('team_name')
      const teamId = url.searchParams.get('team_id')
      const plan = url.searchParams.get('plan')

      if (!apiKey || !teamName || !teamId) { res.writeHead(400); res.end(); return }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!DOCTYPE html><html><head><title>clauditor</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0d0d14;color:#e8e8f0}
.c{text-align:center;padding:3rem;background:#181828;border-radius:1rem;border:1px solid #2a2a42}
.k{font-size:3rem;margin-bottom:1rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9898b0;font-size:.875rem;margin:0}</style>
</head><body><div class="c"><div class="k">✓</div><h1>Logged in to ${teamName}</h1><p>You can close this tab.</p></div></body></html>`)

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
