/**
 * OpenAuth 0.4.3 has no `issuer:` config. Real JWT `iss` and the authorization
 * server metadata (RFC 8414) come from getRelativeUrl (request origin +
 * X-Forwarded-Host/Proto/Port).
 *
 * When PUBLIC_ISSUER_URL is set, inject those headers so OpenAuth pins `iss`
 * to the public origin relying parties use as AUTH_ISSUER. Does not rewrite JWTs.
 */
export function parsePublicIssuerUrl(
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const raw = env.PUBLIC_ISSUER_URL?.trim();
  if (!raw) return null;

  let publicUrl: URL;
  try {
    publicUrl = new URL(raw);
  } catch {
    throw new Error(
      `Invalid PUBLIC_ISSUER_URL ${JSON.stringify(raw)}: want an http:// or https:// URL`,
    );
  }
  if (
    (publicUrl.protocol !== "http:" && publicUrl.protocol !== "https:") ||
    !publicUrl.host
  ) {
    throw new Error(
      `Invalid PUBLIC_ISSUER_URL ${JSON.stringify(raw)}: want an http:// or https:// URL`,
    );
  }
  return publicUrl;
}

export function formatPublicIssuerUrl(url: URL): string {
  return url.href.replace(/\/+$/, "");
}

export function applyPublicIssuerUrl(
  request: Request,
  parsed: URL | null | undefined = undefined,
): Request {
  const publicUrl =
    parsed === undefined ? parsePublicIssuerUrl(process.env) : parsed;
  if (!publicUrl) return request;

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.replace(/:$/, ""));
  headers.set(
    "x-forwarded-port",
    publicUrl.port || (publicUrl.protocol === "https:" ? "443" : "80"),
  );
  return new Request(request, { headers });
}
