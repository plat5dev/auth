import { format } from "node:util";
import { OauthError, UnknownStateError } from "@openauthjs/openauth/error";

import { filterConsoleErrorArgs } from "./client-error.ts";
import { logger } from "./logger.ts";

/**
 * Every line on stdout is a JSON log line (docs/telemetry.md). OpenAuth and its
 * Hono app write plain text through `console`; this turns what they write into
 * log lines:
 *
 * - Hono's request logger (`<-- GET /x`, `--> GET /x 200 1ms`) is dropped: the
 *   issuer writes its own request line.
 * - OpenAuth's `console.error` of a protocol error is an `info` line: the client
 *   got the OAuth error. Of the generic error the issuer handed it, nothing: the
 *   real one is already logged.
 * - Anything else keeps its level: `error`, `warn`, else `info`.
 */
export function installConsoleCapture(target: Console = console): void {
  target.log = (...args: unknown[]) => line("info", args);
  target.info = (...args: unknown[]) => line("info", args);
  target.debug = (...args: unknown[]) => line("debug", args);
  target.warn = (...args: unknown[]) => line("warn", args);
  target.error = (...args: unknown[]) => filterConsoleErrorArgs(args, (...rest) => line("error", rest));
}

function line(level: "debug" | "info" | "warn" | "error", args: unknown[]): void {
  const first = args[0];
  if (level !== "error" && typeof first === "string" && /^(<--|-->) /.test(first)) {
    return;
  }
  if (first instanceof OauthError) {
    logger.info("OAuth error response", {
      oauth_error: first.error,
      oauth_error_description: first.description,
    });
    return;
  }
  if (first instanceof UnknownStateError) {
    logger.info("OAuth error response", { oauth_error: "unknown_state" });
    return;
  }
  const error = args.find((a) => a instanceof Error);
  const message = format(...args.filter((a) => a !== error)) || (error as Error | undefined)?.message || "";
  if (level === "error") {
    logger.error(message, error);
  } else {
    logger[level](message, error instanceof Error ? { error_message: error.message } : undefined);
  }
}
