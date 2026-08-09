/**
 * Standard error kinds for telemetry.
 * Used in span attributes and log fields.
 * Closed set: auth, network, db, io, internal, validation.
 */
export const ErrorKind = {
  Auth: "auth",
  Network: "network",
  DB: "db",
  IO: "io",
  Internal: "internal",
  Validation: "validation",
} as const;

export type ErrorKindType = (typeof ErrorKind)[keyof typeof ErrorKind];
