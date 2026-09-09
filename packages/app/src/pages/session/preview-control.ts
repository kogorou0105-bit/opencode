import { decodePreviewControlCommand, type PreviewStatusReport } from "@opencode-ai/schema/preview-control"
import type { PreviewStatus } from "@/context/preview"

type PreviewControlTarget = {
  status: () => PreviewStatus
  error: () => string | undefined
  url: () => string | undefined
  open: (url: string) => Promise<boolean>
  close: () => void
  refresh: () => Promise<boolean>
}

export async function applyPreviewControlCommand(
  command: string,
  sessionID: string | undefined,
  preview: PreviewControlTarget,
  openPanel: () => void,
  closePanel: () => void,
  report: (status: PreviewStatusReport) => void,
) {
  const input = decodePreviewControlCommand(command)
  if (!input || input.sessionID !== sessionID) return false

  if (input.action === "open") {
    openPanel()
    await preview.open(input.url!)
  } else if (input.action === "close") {
    preview.close()
    closePanel()
  } else {
    await preview.refresh()
  }

  const error = preview.error()
  const url = preview.url()
  report({
    requestID: input.requestID,
    sessionID: input.sessionID,
    status: preview.status(),
    ...(url ? { url } : {}),
    ...(error ? { error } : {}),
  })
  return true
}
