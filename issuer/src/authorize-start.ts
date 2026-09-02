/**
 * OpenAuth's /authorize always 302s to /{provider}/authorize (login).
 * Honor prompt=create by sending that hop to /{provider}/register instead.
 *
 * Only `create` is honored. Other prompt values are ignored — this is not
 * full OIDC prompt (none / login / consent are not implemented).
 * Does not skip allow(); that already ran. Does not make /password/register
 * a public entry.
 */
export function authorizeStartLocation(
  request: Request,
  location: string | null,
): string | null {
  if (!location) return location;
  if (!wantsRegisterStart(request)) return location;
  return rewriteProviderLoginToRegister(location) ?? location;
}

function wantsRegisterStart(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.pathname !== "/authorize") return false;
  const prompt = url.searchParams.get("prompt");
  if (!prompt) return false;
  return prompt.split(/\s+/).includes("create");
}

function rewriteProviderLoginToRegister(location: string): string | null {
  let url: URL;
  try {
    url = new URL(location, "http://openauth.invalid");
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/([A-Za-z0-9_-]+)\/authorize$/);
  if (!match) return null;
  url.pathname = `/${match[1]}/register`;
  if (location.startsWith("/")) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}
