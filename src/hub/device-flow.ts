/**
 * Device flow client (RFC 8628) for CLI authentication.
 *
 * Used when browser-based localhost callback isn't available
 * (SSH, headless, remote environments, or --no-browser flag).
 */

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_url: string
  expires_in: number
  interval: number
}

export interface DeviceTokenResponse {
  api_key: string
  team_name: string
  team_id: string
  plan: string
}

/**
 * Request a device code from the hub.
 */
export async function requestDeviceCode(
  hubUrl: string,
  projectHash?: string,
  developerHash?: string
): Promise<DeviceCodeResponse> {
  const res = await fetch(`${hubUrl}/api/v1/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_hash: projectHash || null,
      developer_hash: developerHash || null,
    }),
  })

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    throw new Error((data.error as string) || `Failed to get device code: ${res.status}`)
  }

  return res.json() as Promise<DeviceCodeResponse>
}

/**
 * Poll for token until user confirms or code expires.
 */
export async function pollForToken(
  hubUrl: string,
  deviceCode: string,
  interval: number = 3,
  expiresIn: number = 900
): Promise<DeviceTokenResponse> {
  const deadline = Date.now() + expiresIn * 1000

  while (Date.now() < deadline) {
    await sleep(interval * 1000)

    const res = await fetch(`${hubUrl}/api/v1/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    })

    if (res.ok) {
      return res.json() as Promise<DeviceTokenResponse>
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const error = data.error as string

    if (error === 'authorization_pending') {
      // Keep polling
      continue
    }

    if (error === 'expired_token') {
      throw new Error('Code expired. Run clauditor login again.')
    }

    throw new Error(error || `Unexpected error: ${res.status}`)
  }

  throw new Error('Code expired. Run clauditor login again.')
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
