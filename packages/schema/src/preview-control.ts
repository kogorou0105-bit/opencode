export const PREVIEW_CONTROL_PREFIX = "preview.control?"
export const PREVIEW_STATUS_PREFIX = "preview.status?"

export type PreviewControlAction = "open" | "close" | "status"
export type PreviewRuntimeStatus = "idle" | "connecting" | "running" | "error"

export type PreviewControlCommand = {
  action: PreviewControlAction
  sessionID: string
  requestID: string
  url?: string
}

export type PreviewStatusReport = {
  requestID: string
  sessionID: string
  status: PreviewRuntimeStatus
  url?: string
  error?: string
}

export function normalizePreviewURL(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.username || url.password) return undefined
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function encodePreviewControlCommand(input: PreviewControlCommand) {
  const params = new URLSearchParams({
    action: input.action,
    session: input.sessionID,
    request: input.requestID,
  })
  if (input.url !== undefined) params.set("url", input.url)
  return PREVIEW_CONTROL_PREFIX + params.toString()
}

export function decodePreviewControlCommand(value: string): PreviewControlCommand | undefined {
  if (!value.startsWith(PREVIEW_CONTROL_PREFIX)) return undefined
  const params = new URLSearchParams(value.slice(PREVIEW_CONTROL_PREFIX.length))
  const action = params.get("action")
  if (action !== "open" && action !== "close" && action !== "status") return undefined

  const sessionID = params.get("session")
  const requestID = params.get("request")
  if (!sessionID || !requestID) return undefined

  const rawURL = params.get("url")
  const url = rawURL === null ? undefined : normalizePreviewURL(rawURL)
  if (action === "open" && !url) return undefined
  if (action !== "open" && rawURL !== null) return undefined

  return { action, sessionID, requestID, ...(url ? { url } : {}) }
}

export function encodePreviewStatusReport(input: PreviewStatusReport) {
  const params = new URLSearchParams({
    request: input.requestID,
    session: input.sessionID,
    status: input.status,
  })
  if (input.url !== undefined) params.set("url", input.url)
  if (input.error !== undefined) params.set("error", input.error)
  return PREVIEW_STATUS_PREFIX + params.toString()
}

export function decodePreviewStatusReport(value: string): PreviewStatusReport | undefined {
  if (!value.startsWith(PREVIEW_STATUS_PREFIX)) return undefined
  const params = new URLSearchParams(value.slice(PREVIEW_STATUS_PREFIX.length))
  const requestID = params.get("request")
  const sessionID = params.get("session")
  if (!requestID || !sessionID) return undefined

  const status = params.get("status")
  if (status !== "idle" && status !== "connecting" && status !== "running" && status !== "error") return undefined

  const rawURL = params.get("url")
  const url = rawURL === null ? undefined : normalizePreviewURL(rawURL)
  if (rawURL !== null && !url) return undefined
  const error = params.get("error") ?? undefined
  return { requestID, sessionID, status, ...(url ? { url } : {}), ...(error ? { error } : {}) }
}
