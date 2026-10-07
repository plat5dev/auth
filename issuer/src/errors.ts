/**
 * Standard error kinds for telemetry.
 * Used in span attributes and log fields.
 * Closed set: auth, network, db, io, internal, validation, config.
 */
export const ErrorKind = {
  Auth: "auth",
  Network: "network",
  DB: "db",
  IO: "io",
  Internal: "internal",
  Validation: "validation",
  Config: "config",
} as const;

export type ErrorKindType = (typeof ErrorKind)[keyof typeof ErrorKind];

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

const loggedErrors = new WeakSet<Error>();

/** Mark an error already written to the structured log, so it is not logged again. */
export function markErrorLogged(error: Error): void {
  loggedErrors.add(error);
}

export function wasErrorLogged(error: Error): boolean {
  return loggedErrors.has(error);
}
