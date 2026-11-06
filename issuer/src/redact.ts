/**
 * The query keys whose values `url.query` never carries (Plat5's telemetry
 * contract, HTTP server spans). Keys match exactly.
 */
const REDACTED_QUERY_KEYS = new Set([
  "sig",
  "Signature",
  "AWSAccessKeyId",
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
  "X-Goog-Signature",
]);

/**
 * The raw query (without `?`) with the value of each redacted key replaced by
 * `REDACTED`. Every other key and value is kept as sent.
 */
export function redactQuery(query: string): string {
  return query
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      return eq >= 0 && REDACTED_QUERY_KEYS.has(part.slice(0, eq))
        ? `${part.slice(0, eq)}=REDACTED`
        : part;
    })
    .join("&");
}
