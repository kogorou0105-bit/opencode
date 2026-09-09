import {
  PREVIEW_PROTOCOL_VERSION,
  isPreviewConnectMessage,
  isPreviewParentMessage,
  type PreviewChildMessage,
  type PreviewSourceLocation,
} from "./protocol.js"

type LocatorFile = {
  filePath?: unknown
  projectPath?: unknown
  expressions?: unknown
}
type LocatorStore = Record<string, LocatorFile>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

declare global {
  interface Window {
    __LOCATOR_DATA__?: LocatorStore
    __OPENCODE_PREVIEW_RUNTIME__?: { dispose: () => void }
  }
}

function integer(value: unknown, minimum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) return undefined
  return value
}

export function sourceLocationFromLocatorID(dataID: string, store: LocatorStore | undefined) {
  if (!store) return undefined
  const separator = dataID.lastIndexOf("::")
  if (separator < 1) return undefined
  const fileID = dataID.slice(0, separator)
  const expressionID = Number(dataID.slice(separator + 2))
  if (!Number.isSafeInteger(expressionID) || expressionID < 0) return undefined

  const file = store[fileID]
  if (!file || typeof file.filePath !== "string" || typeof file.projectPath !== "string") return undefined
  if (!Array.isArray(file.expressions)) return undefined
  const expression = file.expressions[expressionID]
  if (!record(expression)) return undefined
  const location = record(expression.loc) ? expression.loc : undefined
  const start = record(location?.start) ? location.start : undefined
  const end = record(location?.end) ? location.end : undefined
  const startLine = integer(start?.line, 1)
  const startColumn = integer(start?.column, 0)
  const endLine = integer(end?.line, 1)
  const endColumn = integer(end?.column, 0)
  if (startLine === undefined || startColumn === undefined || endLine === undefined || endColumn === undefined)
    return undefined

  return {
    filePath: file.filePath,
    projectPath: file.projectPath,
    componentName: typeof expression?.name === "string" ? expression.name : undefined,
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn },
  } satisfies PreviewSourceLocation
}

function locatorElement(event: Event) {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue
    const element = target.closest<HTMLElement>("[data-locatorjs-id]")
    if (element) return element
  }
  return undefined
}

function referrerOrigin() {
  if (!document.referrer) return undefined
  try {
    return new URL(document.referrer).origin
  } catch {
    return undefined
  }
}

function createOverlay() {
  const overlay = document.createElement("div")
  overlay.dataset.opencodePreviewOverlay = ""
  Object.assign(overlay.style, {
    position: "fixed",
    display: "none",
    pointerEvents: "none",
    zIndex: "2147483647",
    border: "2px solid #6c8cff",
    borderRadius: "3px",
    background: "rgba(108, 140, 255, 0.12)",
    boxSizing: "border-box",
  })
  document.documentElement.append(overlay)
  return overlay
}

export function setupPreviewRuntime() {
  window.__OPENCODE_PREVIEW_RUNTIME__?.dispose()

  const overlay = createOverlay()
  let port: MessagePort | undefined
  let nonce: string | undefined
  let inspecting = false
  let selected: HTMLElement | undefined
  let frame: number | undefined

  const render = () => {
    frame = undefined
    if (!inspecting || !selected?.isConnected) {
      overlay.style.display = "none"
      return
    }
    const rect = selected.getBoundingClientRect()
    overlay.style.display = "block"
    overlay.style.left = `${rect.left}px`
    overlay.style.top = `${rect.top}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
  }

  const requestRender = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(render)
  }

  const setInspecting = (enabled: boolean) => {
    inspecting = enabled
    if (!enabled) selected = undefined
    requestRender()
    document.documentElement.style.cursor = enabled ? "crosshair" : ""
  }

  const send = (message: PreviewChildMessage) => port?.postMessage(message)

  const onPointerMove = (event: PointerEvent) => {
    if (!inspecting) return
    selected = locatorElement(event)
    requestRender()
  }

  const onClick = (event: MouseEvent) => {
    if (!inspecting) return
    const element = locatorElement(event)
    const dataID = element?.dataset.locatorjsId
    if (!dataID || !nonce) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const location = sourceLocationFromLocatorID(dataID, window.__LOCATOR_DATA__)
    if (!location) {
      send({
        type: "error",
        version: PREVIEW_PROTOCOL_VERSION,
        nonce,
        message: "Unable to resolve LocatorJS source metadata",
      })
      return
    }
    setInspecting(false)
    send({ type: "selected", version: PREVIEW_PROTOCOL_VERSION, nonce, location })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!inspecting || event.key !== "Escape") return
    event.preventDefault()
    setInspecting(false)
  }

  const onViewportChange = () => requestRender()

  const connect = (event: MessageEvent) => {
    if (event.source !== window.parent || !isPreviewConnectMessage(event.data)) return
    const expectedOrigin = referrerOrigin()
    if (expectedOrigin && event.origin !== expectedOrigin) return
    const next = event.ports[0]
    if (!next) return

    port?.close()
    port = next
    nonce = event.data.nonce
    port.onmessage = (message) => {
      if (!isPreviewParentMessage(message.data) || message.data.nonce !== nonce) return
      if (message.data.type === "dispose") {
        setInspecting(false)
        port?.close()
        port = undefined
        return
      }
      setInspecting(message.data.enabled)
    }
    port.start()
    send({ type: "ready", version: PREVIEW_PROTOCOL_VERSION, nonce })
  }

  window.addEventListener("message", connect)
  window.addEventListener("pointermove", onPointerMove, true)
  window.addEventListener("click", onClick, true)
  window.addEventListener("keydown", onKeyDown, true)
  window.addEventListener("scroll", onViewportChange, true)
  window.addEventListener("resize", onViewportChange)

  const dispose = () => {
    setInspecting(false)
    if (frame !== undefined) cancelAnimationFrame(frame)
    port?.close()
    overlay.remove()
    window.removeEventListener("message", connect)
    window.removeEventListener("pointermove", onPointerMove, true)
    window.removeEventListener("click", onClick, true)
    window.removeEventListener("keydown", onKeyDown, true)
    window.removeEventListener("scroll", onViewportChange, true)
    window.removeEventListener("resize", onViewportChange)
    if (window.__OPENCODE_PREVIEW_RUNTIME__?.dispose === dispose) delete window.__OPENCODE_PREVIEW_RUNTIME__
  }

  window.__OPENCODE_PREVIEW_RUNTIME__ = { dispose }
  return { dispose }
}
