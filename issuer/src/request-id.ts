import { randomUUID } from "node:crypto";

/**
 * Visible printable ASCII (no whitespace, CR/LF, or control chars), 1..128 chars.
 */
const VALID_REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;

/**
 * Returns the incoming X-Request-ID if it is valid printable ASCII up to 128
 * characters, otherwise generates a fresh UUID.
 */
export function resolveRequestId(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed && VALID_REQUEST_ID_RE.test(trimmed)) {
    return trimmed;
  }
  return randomUUID();
}
