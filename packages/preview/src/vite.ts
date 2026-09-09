import { transformAsync, type ParserOptions } from "@babel/core"
import locatorBabelPlugin from "@locator/babel-jsx"
import type { Plugin } from "vite"

const VIRTUAL_ID = "virtual:opencode-preview-runtime"
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

export function previewRuntimeTag() {
  return {
    tag: "script",
    attrs: { type: "module", src: `/@id/${VIRTUAL_ID}` },
    injectTo: "head-prepend" as const,
  }
}

function parserPlugins(id: string): NonNullable<ParserOptions["plugins"]> {
  if (id.endsWith(".tsx")) return ["typescript", "jsx"]
  return ["jsx"]
}

export async function transformPreviewSource(code: string, id: string, root: string) {
  const result = await transformAsync(code, {
    filename: id,
    cwd: root,
    babelrc: false,
    configFile: false,
    sourceMaps: true,
    parserOpts: {
      sourceType: "module",
      plugins: parserPlugins(id),
    },
    plugins: [locatorBabelPlugin],
  })
  if (!result?.code) return undefined
  return { code: result.code, map: result.map ?? null }
}

export function opencodePreview(): Plugin {
  let root = process.cwd()
  return {
    name: "opencode-preview",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
      return undefined
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined
      return [
        `import { setupPreviewRuntime } from "@opencode-ai/preview/runtime"`,
        `const runtime = setupPreviewRuntime()`,
        `if (import.meta.hot) import.meta.hot.dispose(() => runtime.dispose())`,
      ].join("\n")
    },
    transform(code, rawID) {
      const id = rawID.split("?", 1)[0] ?? rawID
      if ((!id.endsWith(".jsx") && !id.endsWith(".tsx")) || id.includes("/node_modules/")) return undefined
      return transformPreviewSource(code, id, root)
    },
    transformIndexHtml() {
      return [previewRuntimeTag()]
    },
  }
}
