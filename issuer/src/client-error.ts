import { OauthError, UnknownStateError } from "@openauthjs/openauth/error";

import {
  ConfigError,
  EmailDeliveryError,
  ErrorKind,
  UNEXPECTED_CLIENT_MESSAGE,
  markErrorLogged,
  wasErrorLogged,
  type ErrorKindType,
} from "./errors.ts";
import { logger, type StructuredLogger } from "./logger.ts";

type ErrorLog = Pick<StructuredLogger, "error">;

/**
 * OpenAuth copies a thrown error's message into OAuth `error_description` and
 * `console.error`s that same error (a second, raw stack). Detail stays in the
 * structured log; the client only sees a generic message.
 */
const suppressRaw = new WeakSet<object>();

let consoleFilterInstalled = false;

export function suppressRawTrace(error: object): void {
  suppressRaw.add(error);
}

/** Drop OpenAuth's raw `console.error(err)` for the generic error handed to the client. */
export function filterConsoleErrorArgs(
  args: unknown[],
  write: (...args: unknown[]) => void,
): void {
  const first = args[0];
  if (
    args.length === 1 &&
    typeof first === "object" &&
    first !== null &&
    suppressRaw.has(first)
  ) {
    return;
  }
  write(...args);
}

export function installRawTraceSuppression(): void {
  if (consoleFilterInstalled) return;
  consoleFilterInstalled = true;
  const write = console.error.bind(console);
  console.error = (...args: Parameters<typeof console.error>) => {
    filterConsoleErrorArgs(args, write);
  };
}

function clientMessage(error: Error): string {
  if (error instanceof ConfigError || error instanceof EmailDeliveryError) {
    return error.clientMessage;
  }
  return UNEXPECTED_CLIENT_MESSAGE;
}

function kindOf(error: Error): ErrorKindType {
  if (error instanceof ConfigError) return ErrorKind.Config;
  if (error instanceof EmailDeliveryError) return ErrorKind.Network;
  return ErrorKind.Internal;
}

/**
 * Error to forward to OpenAuth's handler.
 * Protocol errors (`OauthError`) and the fixed unknown-state page pass through.
 * Everything else is logged once (if not already) and replaced.
 */
export function toClientError(err: unknown, log: ErrorLog = logger): Error {
  if (err instanceof OauthError || err instanceof UnknownStateError) {
    return err;
  }

  const error = err instanceof Error ? err : new Error("Unknown error");
  if (!wasErrorLogged(error)) {
    if (err instanceof Error) {
      log.error("Request failed", error, {
        error: true,
        error_kind: kindOf(error),
      });
    } else {
      log.error("Request failed", undefined, {
        error: true,
        error_kind: ErrorKind.Internal,
        error_message: String(err),
      });
    }
    markErrorLogged(error);
  }

  const safe = new Error(clientMessage(err instanceof Error ? err : error));
  suppressRawTrace(safe);
  return safe;
}

type ErrorBoundaryApp = {
  onError(handler: (err: Error, c: unknown) => unknown): void;
};

/**
 * Wrap the issuer's Hono error handler so internal/config text never reaches
 * the OAuth client, and OpenAuth's raw `console.error(err)` is dropped.
 */
export function installClientErrorBoundary(
  app: ErrorBoundaryApp,
  log: ErrorLog = logger,
): void {
  installRawTraceSuppression();
  const host = app as ErrorBoundaryApp & {
    errorHandler: (err: Error, c: unknown) => unknown;
  };
  const previous = host.errorHandler.bind(host);
  host.onError((err, c) => previous(toClientError(err, log), c));
}
