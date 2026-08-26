/**
 * OpenAuth 0.4.3 has no `issuer:` config. Real JWT `iss` and OIDC discovery
 * come from getRelativeUrl (request origin + X-Forwarded-Host/Proto/Port).
 *
 * When PUBLIC_ISSUER_URL is set, inject those headers so OpenAuth pins `iss`
 * to the public origin relying parties use as AUTH_ISSUER. Does not rewrite JWTs.
 */
export function applyPublicIssuerUrl(request: Request): Request {
  const raw = process.env.PUBLIC_ISSUER_URL?.trim().replace(/\/$/, "");
  if (!raw) return request;

  let publicUrl: URL;
  try {
    publicUrl = new URL(raw);
  } catch {
    return request;
  }
  if (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.replace(/:$/, ""));
  headers.set(
    "x-forwarded-port",
    publicUrl.port || (publicUrl.protocol === "https:" ? "443" : "80"),
  );
  return new Request(request, { headers });
}
