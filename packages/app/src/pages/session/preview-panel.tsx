import {
  PREVIEW_CONNECT_MESSAGE,
  PREVIEW_PROTOCOL_VERSION,
  isPreviewChildMessage,
  type PreviewSourceLocation,
} from "@opencode-ai/preview/protocol"
import { previewSelectedLines } from "@opencode-ai/session-ui/pierre/selection-bridge"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { resolvePreviewSource, usePreview } from "@/context/preview"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { showToast } from "@/utils/toast"

function nonce() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

export function PreviewPanel() {
  const file = useFile()
  const language = useLanguage()
  const platform = usePlatform()
  const preview = usePreview()
  const prompt = usePrompt()
  const sdk = useSDK()
  const { sessionKey, tabs } = useSessionLayout()
  const [state, setState] = createStore({ connected: false, inspecting: false, target: "" })
  const running = createMemo(() => preview.status() === "running" && !!preview.url())
  let iframe: HTMLIFrameElement | undefined
  let port: MessagePort | undefined
  let channelNonce: string | undefined

  const post = (message: { type: "inspect"; enabled: boolean } | { type: "dispose" }) => {
    if (!port || !channelNonce) return
    port.postMessage({ ...message, version: PREVIEW_PROTOCOL_VERSION, nonce: channelNonce })
  }

  const disconnect = () => {
    if (port && channelNonce) {
      port.postMessage({ type: "dispose", version: PREVIEW_PROTOCOL_VERSION, nonce: channelNonce })
    }
    port?.close()
    port = undefined
    channelNonce = undefined
    setState("connected", false)
  }

  const openSource = async (location: PreviewSourceLocation) => {
    const directory = sdk().directory
    const source = resolvePreviewSource(directory, location)
    if (!source) {
      showToast({ variant: "error", title: language.t("session.preview.sourceOutsideWorkspace") })
      return
    }

    const owner = sessionKey()
    const sessionTabs = tabs()
    const promptSession = prompt.capture()
    await file.load(source.path)
    if (sdk().directory !== directory || sessionKey() !== owner) return
    if (!file.get(source.path)?.loaded) return

    const range = { start: source.selection.startLine, end: source.selection.endLine }
    const content = file.get(source.path)?.content?.content
    const excerpt = content ? previewSelectedLines(content, range) : undefined
    file.revealLines(source.path, range)
    const tab = file.tab(source.path)
    void sessionTabs.open(tab)
    sessionTabs.setActive(tab)
    promptSession.context.add({
      type: "file",
      path: source.path,
      selection: source.selection,
      preview: excerpt,
    })
    setState("inspecting", false)
  }

  const connect = () => {
    disconnect()
    const url = preview.url()
    if (!iframe?.contentWindow || !running() || !url) return
    const nextNonce = nonce()
    const channel = new MessageChannel()
    channelNonce = nextNonce
    port = channel.port1
    port.onmessage = (event) => {
      if (!isPreviewChildMessage(event.data) || event.data.nonce !== channelNonce) return
      if (event.data.type === "ready") {
        setState("connected", true)
        post({ type: "inspect", enabled: state.inspecting })
        return
      }
      if (event.data.type === "error") {
        showToast({
          variant: "error",
          title: language.t("session.preview.inspectorError"),
          description: event.data.message,
        })
        return
      }
      void openSource(event.data.location)
    }
    port.start()
    iframe.contentWindow.postMessage(
      { type: PREVIEW_CONNECT_MESSAGE, version: PREVIEW_PROTOCOL_VERSION, nonce: nextNonce },
      new URL(url).origin,
      [channel.port2],
    )
  }

  const setInspecting = (enabled: boolean) => {
    setState("inspecting", enabled)
    post({ type: "inspect", enabled })
  }

  const reload = () => {
    const url = preview.url()
    if (!url) return
    disconnect()
    iframe?.setAttribute("src", url)
  }

  createEffect(() => {
    const url = preview.url()
    if (url) setState("target", url)
  })

  createEffect(() => {
    if (running()) return
    disconnect()
  })

  onCleanup(disconnect)

  return (
    <div class="size-full min-h-0 flex flex-col bg-background-base">
      <div class="h-10 shrink-0 px-3 flex items-center gap-2 border-b border-border-weak-base">
        <div class="min-w-0 flex-1 flex items-center gap-2">
          <span
            class="size-2 rounded-full"
            classList={{
              "bg-icon-success-base": running(),
              "bg-icon-warning-base": preview.status() === "connecting",
              "bg-icon-critical-base": preview.status() === "error",
              "bg-icon-weak-base": preview.status() === "idle",
            }}
          />
          <span class="truncate text-12-regular text-text-weak">
            {preview.url() ?? language.t("session.tab.preview")}
          </span>
          <Show when={running() && !state.connected}>
            <span class="shrink-0 text-11-regular text-text-faint">
              {language.t("session.preview.locatorUnavailable")}
            </span>
          </Show>
        </div>
        <Show when={running()}>
          <Button
            size="small"
            variant={state.inspecting ? "primary" : "ghost"}
            icon="window-cursor"
            aria-pressed={state.inspecting}
            onClick={() => setInspecting(!state.inspecting)}
          >
            {language.t("session.preview.inspect")}
          </Button>
          <Button size="small" variant="ghost" icon="reset" onClick={reload}>
            {language.t("session.preview.reload")}
          </Button>
          <Button
            size="small"
            variant="ghost"
            icon="square-arrow-top-right"
            onClick={() => {
              const url = preview.url()
              if (url) platform.openExternal(url)
            }}
          >
            {language.t("common.open")}
          </Button>
          <Button size="small" variant="ghost" icon="close" onClick={preview.close}>
            {language.t("common.close")}
          </Button>
        </Show>
      </div>

      <Show
        when={running()}
        fallback={
          <div class="flex-1 min-h-0 px-8 flex items-center justify-center">
            <form
              class="w-full max-w-md flex flex-col items-center gap-4 text-center"
              onSubmit={(event) => {
                event.preventDefault()
                void preview.open(state.target)
              }}
            >
              <div class="size-12 rounded-xl flex items-center justify-center bg-background-stronger text-icon-weak">
                <Icon name="window-cursor" size="large" />
              </div>
              <div class="text-14-medium text-text-strong">
                {preview.status() === "connecting"
                  ? language.t("session.preview.starting")
                  : language.t("session.preview.heading")}
              </div>
              <label class="w-full flex flex-col gap-1 text-left text-11-medium text-text-weak">
                {language.t("dialog.server.add.url")}
                <input
                  class="h-8 min-w-0 rounded-md border border-border-weak-base bg-background-stronger px-2 text-12-regular text-text-strong outline-none focus:border-border-focus"
                  type="url"
                  value={state.target}
                  disabled={preview.status() === "connecting"}
                  onInput={(event) => setState("target", event.currentTarget.value)}
                />
              </label>
              <Show when={preview.error()}>
                {(error) => <div class="text-12-regular text-text-critical-base">{error()}</div>}
              </Show>
              <Button type="submit" variant="primary" disabled={preview.status() === "connecting" || !state.target}>
                {language.t("common.open")}
              </Button>
            </form>
          </div>
        }
      >
        <iframe
          ref={iframe}
          src={preview.url() ?? ""}
          title={language.t("session.tab.preview")}
          class="flex-1 min-h-0 w-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
          referrerPolicy="strict-origin"
          onLoad={connect}
        />
      </Show>
    </div>
  )
}
