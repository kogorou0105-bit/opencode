import type { PreviewSourceLocation } from "@opencode-ai/preview/protocol"
import { normalizePreviewURL } from "@opencode-ai/schema/preview-control"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useParams } from "@solidjs/router"
import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "./sdk"
import { useServerSDK } from "./server-sdk"
import { useLanguage } from "./language"
import { Persist, persisted } from "@/utils/persist"

export { normalizePreviewURL }

export type PreviewStatus = "idle" | "connecting" | "running" | "error"

export type ResolvedPreviewSource = {
  path: string
  componentName?: string
  selection: {
    startLine: number
    startChar: number
    endLine: number
    endChar: number
  }
}

type PreviewRequest = (url: string, init: RequestInit) => Promise<unknown>

export async function previewServerAvailable(url: string, request: PreviewRequest = globalThis.fetch, timeout = 1_500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    await request(url, { mode: "no-cors", cache: "no-store", signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function absolutePath(value: string) {
  const input = value.replaceAll("\\", "/")
  const drive = input.match(/^([A-Za-z]:)(?:\/|$)/)?.[1]
  const unc = input.startsWith("//")
  if (!drive && !unc && !input.startsWith("/")) return undefined

  const raw = drive ? input.slice(drive.length) : input
  const segments = raw.split("/").filter(Boolean)
  const root = unc ? segments.splice(0, 2) : []
  if (unc && root.length !== 2) return undefined

  const parts: string[] = []
  for (const segment of segments) {
    if (segment === ".") continue
    if (segment === "..") {
      if (!parts.pop()) return undefined
      continue
    }
    parts.push(segment)
  }

  if (drive) return `${drive.toLowerCase()}/${parts.join("/")}`
  if (unc) return `//${root.join("/")}${parts.length ? `/${parts.join("/")}` : ""}`
  return `/${parts.join("/")}`
}

function samePathPlatform(a: string, b: string) {
  const insensitive = /^[a-z]:\//i.test(a) || a.startsWith("//")
  return insensitive ? a.toLowerCase() === b.toLowerCase() : a === b
}

function relativePath(base: string, target: string) {
  if (samePathPlatform(base, target)) return ""
  const insensitive = /^[a-z]:\//i.test(base) || base.startsWith("//")
  const prefix = `${base}/`
  const matches = insensitive ? target.toLowerCase().startsWith(prefix.toLowerCase()) : target.startsWith(prefix)
  if (!matches) return undefined
  return target.slice(prefix.length)
}

export function resolvePreviewSource(
  workspace: string,
  location: PreviewSourceLocation,
): ResolvedPreviewSource | undefined {
  const root = absolutePath(workspace)
  const project = absolutePath(location.projectPath)
  if (!root || !project || relativePath(root, project) === undefined) return undefined

  const rawFile = location.filePath.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!rawFile || /^[A-Za-z]:\//.test(rawFile)) return undefined
  const target = absolutePath(`${project}/${rawFile}`)
  if (!target || relativePath(project, target) === undefined) return undefined

  const path = relativePath(root, target)
  if (!path) return undefined
  const startsAfterEnd =
    location.start.line > location.end.line ||
    (location.start.line === location.end.line && location.start.column > location.end.column)
  if (startsAfterEnd) return undefined

  return {
    path,
    componentName: location.componentName,
    selection: {
      startLine: location.start.line,
      startChar: location.start.column,
      endLine: location.end.line,
      endChar: location.end.column,
    },
  }
}

export const { use: usePreview, provider: PreviewProvider } = createSimpleContext({
  name: "Preview",
  gate: false,
  init: () => {
    const params = useParams()
    const sdk = useSDK()
    const serverSDK = useServerSDK()
    const language = useLanguage()
    const [config, setConfig, _, ready] = persisted(
      Persist.serverScoped(serverSDK().scope, sdk().directory, params.id, "preview.url"),
      createStore({ url: "" }),
    )
    const [runtime, setRuntime] = createStore<{
      status: PreviewStatus
      error?: string
    }>({ status: "idle" })
    let generation = 0

    const connect = async (url: string) => {
      const current = ++generation
      setRuntime({ status: "connecting", error: undefined })
      const available = await previewServerAvailable(url)
      if (current !== generation) return false
      if (!available) {
        setRuntime({ status: "error", error: language.t("session.preview.serverUnreachable", { url }) })
        return false
      }
      setRuntime({ status: "running", error: undefined })
      return true
    }

    const open = async (value: string) => {
      const url = normalizePreviewURL(value)
      if (!url) {
        generation += 1
        setRuntime({ status: "error", error: language.t("dialog.server.add.error") })
        return false
      }
      setConfig("url", url)
      return connect(url)
    }

    const close = () => {
      generation += 1
      setRuntime({ status: "idle", error: undefined })
    }

    const refresh = async () => {
      if (runtime.status === "idle") return true
      const url = normalizePreviewURL(config.url)
      if (!url) {
        close()
        return false
      }
      return connect(url)
    }

    onCleanup(() => {
      generation += 1
    })

    return {
      ready,
      status: createMemo(() => runtime.status),
      error: createMemo(() => runtime.error),
      url: createMemo(() => normalizePreviewURL(config.url)),
      open,
      close,
      refresh,
    }
  },
})
