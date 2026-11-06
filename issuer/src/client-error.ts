import { OauthError, UnknownStateError } from "@openauthjs/openauth/error";

import {
  ConfigError,
  EmailDeliveryError,
  ErrorType,
  UNEXPECTED_CLIENT_MESSAGE,
  markErrorLogged,
  wasErrorLogged,
  type ErrorTypeValue,
} from "./errors.ts";
import { logger, type StructuredLogger } from "./logger.ts";

type ErrorLog = Pick<StructuredLogger, "error">;

/**
 * OpenAuth copies a thrown error's message into OAuth `error_description` and
 * `console.error`s that same error (a second, raw stack). Detail stays in the
 * structured log; the client only sees a generic message.
 */
const suppressRaw = new WeakSet<object>();

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

function clientMessage(error: Error): string {
  if (error instanceof ConfigError || error instanceof EmailDeliveryError) {
    return error.clientMessage;
  }
  return UNEXPECTED_CLIENT_MESSAGE;
}

function typeOf(error: Error): ErrorTypeValue {
  return error instanceof EmailDeliveryError ? ErrorType.Network : ErrorType.Internal;
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
      log.error("Request failed", error, { error_type: typeOf(error) });
    } else {
      log.error("Request failed", err);
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
 * the OAuth client. OpenAuth's raw `console.error(err)` of the replacement is
 * dropped by the console capture (console.ts).
 */
export function installClientErrorBoundary(
  app: ErrorBoundaryApp,
  log: ErrorLog = logger,
): void {
  const host = app as ErrorBoundaryApp & {
    errorHandler: (err: Error, c: unknown) => unknown;
  };
  const previous = host.errorHandler.bind(host);
  host.onError((err, c) => previous(toClientError(err, log), c));
}
