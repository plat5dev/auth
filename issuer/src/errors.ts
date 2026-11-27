/**
 * The `error_type` log field and `error.type` span attribute values
 * (Plat5's telemetry contract). Closed set.
 */
export const ErrorType = {
  Auth: "auth",
  Network: "network",
  DB: "db",
  IO: "io",
  Internal: "internal",
  Validation: "validation",
} as const;

export type ErrorTypeValue = (typeof ErrorType)[keyof typeof ErrorType];

/** OAuth `error_description` when a code cannot be sent because config is incomplete. */
export const SIGNUP_UNAVAILABLE_MESSAGE = "Sign-up is temporarily unavailable.";

/** OAuth `error_description` for any other internal failure. */
export const UNEXPECTED_CLIENT_MESSAGE = "An unexpected error occurred.";

/**
 * Operator-facing configuration failure (missing SMTP, bad port, …).
 * `message` is for logs only. Clients get `clientMessage`.
 */
export class ConfigError extends Error {
  readonly clientMessage = SIGNUP_UNAVAILABLE_MESSAGE;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * The login code could not be delivered (SMTP unreachable, timed out, rejected).
 * `message` and `cause` are for logs only. Clients get the same message as a
 * missing SMTP config.
 */
export class EmailDeliveryError extends Error {
  readonly clientMessage = SIGNUP_UNAVAILABLE_MESSAGE;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EmailDeliveryError";
  }
}

const loggedErrors = new WeakSet<Error>();

/** Mark an error already written to the structured log, so it is not logged again. */
export function markErrorLogged(error: Error): void {
  loggedErrors.add(error);
}

export function wasErrorLogged(error: Error): boolean {
  return loggedErrors.has(error);
}

const DB_UNAVAILABLE_CODES = new Set([
  // TCP / socket / DNS errors (Node & Bun)
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "ConnectionRefused",
  "FailedToOpenSocket",
  "ERR_SOCKET_CLOSED",
  // postgres.js connection lifecycle errors
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "CONNECTION_CONNECT_TIMEOUT",
]);

function isPostgresUnavailableSqlState(code: string): boolean {
  // Class 08: Connection Exception
  // Class 53: Insufficient Resources (e.g. 53300 too_many_connections)
  // Class 57: Operator Intervention (e.g. 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now)
  return (
    code.length === 5 &&
    (code.startsWith("08") || code.startsWith("53") || code.startsWith("57"))
  );
}

/**
 * Returns true when an error indicates Postgres is unreachable, shutting down,
 * or refusing connections (so callers should receive 503 SERVICE_UNAVAILABLE
 * rather than 500 INTERNAL_ERROR).
 */
export function isDatabaseUnavailableError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 6) {
    return false;
  }
  const obj = error as Record<string, unknown>;
  for (const key of ["code", "errno"] as const) {
    const val = obj[key];
    if (typeof val === "string") {
      if (DB_UNAVAILABLE_CODES.has(val) || isPostgresUnavailableSqlState(val)) {
        return true;
      }
    }
  }
  if (typeof obj.message === "string") {
    const msg = obj.message;
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("CONNECT_TIMEOUT") ||
      msg.includes("CONNECTION_CLOSED") ||
      msg.includes("CONNECTION_ENDED") ||
      msg.includes("Unable to connect")
    ) {
      return true;
    }
  }
  if ("cause" in obj && isDatabaseUnavailableError(obj.cause, depth + 1)) {
    return true;
  }
  if (Array.isArray(obj.errors)) {
    for (const inner of obj.errors) {
      if (isDatabaseUnavailableError(inner, depth + 1)) {
        return true;
      }
    }
  }
  return false;
}
