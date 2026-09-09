import {
  decodePreviewStatusReport,
  encodePreviewControlCommand,
  normalizePreviewURL,
  type PreviewStatusReport,
} from "@opencode-ai/schema/preview-control"
import { TuiEvent } from "@opencode-ai/schema/tui-event"
import { Deferred, Effect, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["open", "close", "status"]).annotate({
    description: "Open or close the connected web client's Preview panel, or inspect its current state",
  }),
  url: Schema.optional(
    Schema.String.annotate({
      description:
        "The exact loopback HTTP URL to display. Required for open. Start the development server before calling this tool.",
    }),
  ),
})

type PreviewMetadata = {
  action: Schema.Schema.Type<typeof Parameters>["action"]
  requestID: string
  sessionID?: string
  status?: PreviewStatusReport["status"]
  url?: string
  error?: string
}

export const PreviewTool = Tool.define(
  "preview",
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    return {
      description:
        "Show a local web app in OpenCode's built-in Preview panel. You must create the app and start its development server yourself, wait until it is reachable, then call open with the exact loopback URL. Preview never starts, restarts, or terminates the app process. Close only disconnects the panel.",
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const url = args.url === undefined ? undefined : normalizePreviewURL(args.url)
          if (args.action === "open" && !url) {
            return yield* Effect.die(new Error("Preview open requires a loopback HTTP URL"))
          }
          if (args.action !== "open" && args.url !== undefined) {
            return yield* Effect.die(new Error(`Preview ${args.action} does not accept a URL`))
          }

          const requestID = crypto.randomUUID()
          const response = yield* Deferred.make<PreviewStatusReport>()
          const unsubscribe = yield* events.listen((event) => {
            if (event.type !== TuiEvent.CommandExecute.type) return Effect.void
            const data = event.data
            if (!data || typeof data !== "object" || !("command" in data) || typeof data.command !== "string") {
              return Effect.void
            }
            const report = decodePreviewStatusReport(data.command)
            if (!report || report.requestID !== requestID || report.sessionID !== ctx.sessionID) return Effect.void
            return Deferred.succeed(response, report).pipe(Effect.asVoid)
          })
          const report = yield* Effect.gen(function* () {
            yield* events.publish(TuiEvent.CommandExecute, {
              command: encodePreviewControlCommand({
                action: args.action,
                sessionID: ctx.sessionID,
                requestID,
                ...(url ? { url } : {}),
              }),
            })
            return yield* Deferred.await(response).pipe(
              Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.succeed(undefined) }),
            )
          }).pipe(Effect.ensuring(unsubscribe))

          const metadata: PreviewMetadata = {
            action: args.action,
            requestID,
            sessionID: ctx.sessionID,
            ...report,
          }
          if (!report) {
            return {
              title: `Preview ${args.action}`,
              metadata,
              output: `Preview ${args.action} could not be confirmed because no connected web client responded.`,
            }
          }

          if (args.action === "close") {
            return {
              title: "Preview closed",
              metadata,
              output: "Preview was closed in the connected web client. The app process was not stopped.",
            }
          }

          return {
            title: args.action === "open" ? "Preview open" : "Preview status",
            metadata,
            output: [
              `Status: ${report.status}`,
              ...(report.url ? [`URL: ${report.url}`] : []),
              ...(report.error ? [`Error: ${report.error}`] : []),
            ].join("\n"),
          }
        }),
    }
  }),
)
