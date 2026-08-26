/**
 * Org invite token plumbing for the IdP.
 *
 * Invite links are Auth /authorize URLs with `invite` (query). The token is
 * stored in an HttpOnly cookie so it survives the password login/register flow.
 * After success, Auth appends `invite` to the OAuth redirect (and, when
 * INVITE_REDEEM_URL matches that redirect target, prefers it). Optionally POSTs
 * to IDENTITY_INVITE_REDEEM_URL (public/gateway URL — Auth must not join plat5's
 * Docker network).
 *
 * Auth does not send invite email. Password-challenge SMTP is unrelated.
 */

export const INVITE_TOKEN_QUERY = "invite";
export const INVITE_COOKIE = "plat5_invite_token";
export const INVITE_COOKIE_MAX_AGE = 60 * 60;
export const INVITE_TOKEN_PREFIX = "inv_";

export function looksLikeInviteToken(token: string): boolean {
  return token.startsWith(INVITE_TOKEN_PREFIX) && token.length > INVITE_TOKEN_PREFIX.length + 8;
}

export function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

export function readInviteToken(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get(INVITE_TOKEN_QUERY)?.trim() ?? "";
  if (fromQuery && looksLikeInviteToken(fromQuery)) return fromQuery;
  const fromCookie = readCookie(request, INVITE_COOKIE)?.trim() ?? "";
  if (fromCookie && looksLikeInviteToken(fromCookie)) return fromCookie;
  return null;
}

function cookieSecure(request: Request): boolean {
  if (request.url.startsWith("https://")) return true;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto === "https";
}

function cookieFlags(secure: boolean, maxAge: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function inviteSetCookieHeader(token: string, secure: boolean): string {
  return `${INVITE_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(secure, INVITE_COOKIE_MAX_AGE)}`;
}

export function inviteClearCookieHeader(secure: boolean): string {
  return `${INVITE_COOKIE}=; ${cookieFlags(secure, 0)}`;
}

export function inviteSetCookieFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const token = url.searchParams.get(INVITE_TOKEN_QUERY)?.trim() ?? "";
  if (!token || !looksLikeInviteToken(token)) return null;
  return inviteSetCookieHeader(token, cookieSecure(request));
}

export function appendInviteToken(location: string, token: string): string {
  const url = new URL(location);
  url.searchParams.set(INVITE_TOKEN_QUERY, token);
  return url.toString();
}

export function sameRedirectTarget(location: string, redeemUrl: string): boolean {
  try {
    const a = new URL(location);
    const b = new URL(redeemUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/**
 * When INVITE_REDEEM_URL is set and matches the OAuth redirect target
 * (origin + path), use it and copy code/state. Otherwise append `invite`
 * to the original Location so token-exchange redirect_uri still matches.
 */
export function locationAfterInvite(
  location: string | null,
  token: string,
  redeemUrl = process.env.INVITE_REDEEM_URL?.trim() ?? "",
): string | null {
  if (redeemUrl) {
    try {
      if (location && sameRedirectTarget(location, redeemUrl)) {
        const dest = new URL(redeemUrl);
        const orig = new URL(location);
        for (const key of ["code", "state", "error", "error_description"]) {
          const v = orig.searchParams.get(key);
          if (v) dest.searchParams.set(key, v);
        }
        dest.searchParams.set(INVITE_TOKEN_QUERY, token);
        return dest.toString();
      }
      const dest = new URL(redeemUrl);
      dest.searchParams.set(INVITE_TOKEN_QUERY, token);
      if (!location) return dest.toString();
    } catch {
      // invalid INVITE_REDEEM_URL — fall through
    }
  }
  if (!location) return null;
  return appendInviteToken(location, token);
}

export function applyInviteToSuccessResponse(
  response: Response,
  token: string,
  secure = false,
): Response {
  const headers = new Headers(response.headers);
  const next = locationAfterInvite(headers.get("Location"), token);
  if (next) headers.set("Location", next);
  headers.append("Set-Cookie", inviteClearCookieHeader(secure));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export type IdentityRedeemFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function callIdentityRedeem(
  token: string,
  userId: string,
  fetchImpl: IdentityRedeemFetch,
): Promise<{ ok: boolean; status: number }> {
  const url = process.env.IDENTITY_INVITE_REDEEM_URL?.trim();
  if (!url) return { ok: true, status: 0 };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const internal = process.env.IDENTITY_INTERNAL_TOKEN?.trim();
  if (internal) headers["X-Plat5-Internal-Token"] = internal;

  const res = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token, user_id: userId }),
  });
  return { ok: res.ok, status: res.status };
}

export async function finishInviteAfterSuccess(
  issued: Response,
  req: Request,
  userId: string,
  log?: { warn: (msg: string, extra?: Record<string, unknown>) => void },
  fetchImpl?: IdentityRedeemFetch,
): Promise<Response> {
  const token = readInviteToken(req);
  if (!token) return issued;

  if (fetchImpl || process.env.IDENTITY_INVITE_REDEEM_URL?.trim()) {
    try {
      const result = await callIdentityRedeem(
        token,
        userId,
        fetchImpl ?? fetch,
      );
      if (!result.ok) {
        log?.warn("Identity invite redeem failed", {
          status: result.status,
          user_id: userId,
        });
      }
    } catch (error) {
      log?.warn("Identity invite redeem errored", {
        user_id: userId,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return applyInviteToSuccessResponse(issued, token, cookieSecure(req));
}
