import { afterEach, describe, expect, test } from "bun:test";

import {
  INVITE_COOKIE,
  INVITE_TOKEN_QUERY,
  appendInviteToken,
  applyInviteToSuccessResponse,
  callIdentityRedeem,
  finishInviteAfterSuccess,
  inviteSetCookieFromRequest,
  locationAfterInvite,
  looksLikeInviteToken,
  readInviteToken,
  sameRedirectTarget,
} from "./invite.ts";

const TOKEN = "inv_" + "A".repeat(40);

afterEach(() => {
  delete process.env.INVITE_REDEEM_URL;
  delete process.env.IDENTITY_INVITE_REDEEM_URL;
  delete process.env.IDENTITY_INTERNAL_TOKEN;
});

describe("looksLikeInviteToken", () => {
  test("accepts inv_ prefix with enough secret", () => {
    expect(looksLikeInviteToken(TOKEN)).toBe(true);
  });
  test("rejects api keys and short values", () => {
    expect(looksLikeInviteToken("plat5-sk-1-abc")).toBe(false);
    expect(looksLikeInviteToken("inv_short")).toBe(false);
    expect(looksLikeInviteToken("")).toBe(false);
  });
});

describe("readInviteToken", () => {
  test("reads query on authorize", () => {
    const req = new Request(
      `http://auth.example.com/authorize?client_id=plat5&${INVITE_TOKEN_QUERY}=${TOKEN}`,
    );
    expect(readInviteToken(req)).toBe(TOKEN);
  });

  test("reads cookie after password POST (query gone)", () => {
    const req = new Request("http://auth.example.com/password/authorize", {
      method: "POST",
      headers: { cookie: `${INVITE_COOKIE}=${encodeURIComponent(TOKEN)}` },
    });
    expect(readInviteToken(req)).toBe(TOKEN);
  });

  test("query wins over cookie", () => {
    const other = "inv_" + "B".repeat(40);
    const req = new Request(
      `http://auth.example.com/authorize?${INVITE_TOKEN_QUERY}=${TOKEN}`,
      { headers: { cookie: `${INVITE_COOKIE}=${other}` } },
    );
    expect(readInviteToken(req)).toBe(TOKEN);
  });

  test("does not accept invite_token query", () => {
    const req = new Request(
      `http://auth.example.com/authorize?invite_token=${TOKEN}`,
    );
    expect(readInviteToken(req)).toBe(null);
  });
});

describe("invite cookie survives authorize → password", () => {
  test("authorize with query sets cookie; password request with that cookie still has token", () => {
    const authorize = new Request(
      `https://auth.example.com/authorize?client_id=plat5&redirect_uri=https://console.example.com/callback&response_type=code&${INVITE_TOKEN_QUERY}=${TOKEN}`,
    );
    const setCookie = inviteSetCookieFromRequest(authorize);
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toContain(INVITE_COOKIE);
    expect(setCookie!).toContain("HttpOnly");
    expect(setCookie!).toContain("Secure");

    const cookieValue = setCookie!.split(";")[0];
    const login = new Request("https://auth.example.com/password/authorize", {
      method: "POST",
      headers: { cookie: cookieValue },
    });
    expect(readInviteToken(login)).toBe(TOKEN);
  });
});

describe("locationAfterInvite", () => {
  test("appends invite= to OAuth redirect", () => {
    const loc = "https://console.example.com/callback?code=abc&state=xyz";
    const next = appendInviteToken(loc, TOKEN);
    expect(next).toContain("code=abc");
    expect(next).toContain(`${INVITE_TOKEN_QUERY}=${TOKEN}`);
  });

  test("INVITE_REDEEM_URL matching redirect copies code/state", () => {
    process.env.INVITE_REDEEM_URL = "https://console.example.com/callback";
    const loc = "https://console.example.com/callback?code=abc&state=xyz";
    const next = locationAfterInvite(loc, TOKEN);
    expect(next).toContain("code=abc");
    expect(next).toContain("state=xyz");
    expect(next).toContain(`${INVITE_TOKEN_QUERY}=${TOKEN}`);
  });

  test("INVITE_REDEEM_URL on a different path does not rewrite (keeps OAuth redirect_uri)", () => {
    process.env.INVITE_REDEEM_URL = "https://console.example.com/invite/redeem";
    const loc = "https://console.example.com/callback?code=abc";
    const next = locationAfterInvite(loc, TOKEN);
    const url = new URL(next!);
    expect(url.pathname).toBe("/callback");
    expect(url.searchParams.get("code")).toBe("abc");
    expect(url.searchParams.get(INVITE_TOKEN_QUERY)).toBe(TOKEN);
  });

  test("sameRedirectTarget", () => {
    expect(
      sameRedirectTarget(
        "https://console.example.com/callback?code=1",
        "https://console.example.com/callback",
      ),
    ).toBe(true);
    expect(
      sameRedirectTarget(
        "https://console.example.com/callback",
        "https://other.example.com/callback",
      ),
    ).toBe(false);
  });
});

describe("applyInviteToSuccessResponse", () => {
  test("appends token and clears cookie", () => {
    const issued = new Response(null, {
      status: 302,
      headers: { Location: "https://console.example.com/callback?code=abc" },
    });
    const out = applyInviteToSuccessResponse(issued, TOKEN);
    expect(out.status).toBe(302);
    const loc = out.headers.get("Location")!;
    expect(loc).toContain("code=abc");
    expect(loc).toContain(`${INVITE_TOKEN_QUERY}=${TOKEN}`);
    const cookie = out.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`${INVITE_COOKIE}=`);
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("callIdentityRedeem", () => {
  test("no-ops when IDENTITY_INVITE_REDEEM_URL is unset", async () => {
    let called = false;
    const result = await callIdentityRedeem(TOKEN, "user1", async () => {
      called = true;
      return new Response(null, { status: 200 });
    });
    expect(called).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(0);
  });

  test("POSTs token + user_id to public identity redeem URL", async () => {
    process.env.IDENTITY_INVITE_REDEEM_URL =
      "https://gateway.example.com/internal/invites/redeem";
    process.env.IDENTITY_INTERNAL_TOKEN = "secret";
    let seen: { url: string; init: RequestInit } | null = null;
    await callIdentityRedeem(TOKEN, "user1", async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "m1" }), { status: 200 });
    });
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe(
      "https://gateway.example.com/internal/invites/redeem",
    );
    expect(seen!.init.method).toBe("POST");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers["X-Plat5-Internal-Token"]).toBe("secret");
    expect(JSON.parse(seen!.init.body as string)).toEqual({
      token: TOKEN,
      user_id: "user1",
    });
  });
});

describe("finishInviteAfterSuccess", () => {
  test("password success with cookie passes token to redeem redirect", async () => {
    process.env.INVITE_REDEEM_URL = "https://console.example.com/callback";
    const req = new Request("https://auth.example.com/password/authorize", {
      method: "POST",
      headers: { cookie: `${INVITE_COOKIE}=${encodeURIComponent(TOKEN)}` },
    });
    const issued = new Response(null, {
      status: 302,
      headers: { Location: "https://console.example.com/callback?code=abc" },
    });
    const out = await finishInviteAfterSuccess(issued, req, "user1");
    const loc = new URL(out.headers.get("Location")!);
    expect(loc.searchParams.get("code")).toBe("abc");
    expect(loc.searchParams.get(INVITE_TOKEN_QUERY)).toBe(TOKEN);
  });

  test("login without invite token is unchanged", async () => {
    const req = new Request("https://auth.example.com/password/authorize", {
      method: "POST",
    });
    const issued = new Response(null, {
      status: 302,
      headers: { Location: "https://console.example.com/callback?code=abc" },
    });
    const out = await finishInviteAfterSuccess(issued, req, "user1");
    expect(out.headers.get("Location")).toBe(
      "https://console.example.com/callback?code=abc",
    );
  });
});
