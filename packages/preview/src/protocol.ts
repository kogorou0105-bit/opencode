export const PREVIEW_PROTOCOL_VERSION = 1 as const
export const PREVIEW_CONNECT_MESSAGE = "opencode.preview.connect" as const

export type PreviewPoint = {
  line: number
  column: number
}

export type PreviewSourceLocation = {
  filePath: string
  projectPath: string
  componentName?: string
  start: PreviewPoint
  end: PreviewPoint
}

export type PreviewConnectMessage = {
  type: typeof PREVIEW_CONNECT_MESSAGE
  version: typeof PREVIEW_PROTOCOL_VERSION
  nonce: string
}

export type PreviewParentMessage =
  | {
      type: "inspect"
      version: typeof PREVIEW_PROTOCOL_VERSION
      nonce: string
      enabled: boolean
    }
  | {
      type: "dispose"
      version: typeof PREVIEW_PROTOCOL_VERSION
      nonce: string
    }

export type PreviewChildMessage =
  | {
      type: "ready"
      version: typeof PREVIEW_PROTOCOL_VERSION
      nonce: string
    }
  | {
      type: "selected"
      version: typeof PREVIEW_PROTOCOL_VERSION
      nonce: string
      location: PreviewSourceLocation
    }
  | {
      type: "error"
      version: typeof PREVIEW_PROTOCOL_VERSION
      nonce: string
      message: string
    }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function point(value: unknown): value is PreviewPoint {
  if (!record(value)) return false
  return (
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line > 0 &&
    typeof value.column === "number" &&
    Number.isSafeInteger(value.column) &&
    value.column >= 0
  )
}

export function isPreviewConnectMessage(value: unknown): value is PreviewConnectMessage {
  if (!record(value)) return false
  return (
    value.type === PREVIEW_CONNECT_MESSAGE &&
    value.version === PREVIEW_PROTOCOL_VERSION &&
    typeof value.nonce === "string" &&
    value.nonce.length >= 16
  )
}

export function isPreviewParentMessage(value: unknown): value is PreviewParentMessage {
  if (!record(value)) return false
  if (value.version !== PREVIEW_PROTOCOL_VERSION || typeof value.nonce !== "string") return false
  if (value.type === "dispose") return true
  return value.type === "inspect" && typeof value.enabled === "boolean"
}

export function isPreviewChildMessage(value: unknown): value is PreviewChildMessage {
  if (!record(value)) return false
  if (value.version !== PREVIEW_PROTOCOL_VERSION || typeof value.nonce !== "string") return false
  if (value.type === "ready") return true
  if (value.type === "error") return typeof value.message === "string"
  if (value.type !== "selected" || !record(value.location)) return false
  const location = value.location
  return (
    typeof location.filePath === "string" &&
    typeof location.projectPath === "string" &&
    (location.componentName === undefined || typeof location.componentName === "string") &&
    point(location.start) &&
    point(location.end)
  )
}
