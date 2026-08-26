import { afterEach, describe, expect, test } from "bun:test";
import { issuer } from "@openauthjs/openauth";
import { MemoryStorage } from "@openauthjs/openauth/storage/memory";
import { createSubjects } from "@openauthjs/openauth/subject";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { object, string } from "valibot";

import { applyPublicIssuerUrl } from "./public-issuer.ts";

const PUBLIC_ISSUER = "https://auth.example.com";
const CONTAINER_ORIGIN = "http://127.0.0.1:5000";

afterEach(() => {
  delete process.env.PUBLIC_ISSUER_URL;
});

describe("applyPublicIssuerUrl", () => {
  test("is a no-op when PUBLIC_ISSUER_URL is unset", () => {
    const request = new Request(`${CONTAINER_ORIGIN}/token`);
    expect(applyPublicIssuerUrl(request)).toBe(request);
  });

  test("injects X-Forwarded-* from PUBLIC_ISSUER_URL, overwriting proxy headers", () => {
    process.env.PUBLIC_ISSUER_URL = `${PUBLIC_ISSUER}/`;
    const request = new Request(`${CONTAINER_ORIGIN}/token`, {
      headers: {
        "x-forwarded-host": "issuer:5000",
        "x-forwarded-proto": "http",
        "x-forwarded-port": "5000",
      },
    });
    const wrapped = applyPublicIssuerUrl(request);
    expect(wrapped).not.toBe(request);
    expect(wrapped.headers.get("x-forwarded-host")).toBe("auth.example.com");
    expect(wrapped.headers.get("x-forwarded-proto")).toBe("https");
    expect(wrapped.headers.get("x-forwarded-port")).toBe("443");
  });
});

describe("OpenAuth-issued JWT iss", () => {
  const subjects = createSubjects({
    user: object({
      user_id: string(),
    }),
  });

  function testApp() {
    return issuer({
      subjects,
      storage: MemoryStorage(),
      providers: {
        test: {
          type: "test",
          init() {},
          async client() {
            return { email: "user@example.com" };
          },
        },
      },
      allow: async () => true,
      success: async (ctx) => {
        return ctx.subject("user", { user_id: "01TESTUSERID00000000000000" });
      },
    });
  }

  async function mintAccessToken(app: ReturnType<typeof testApp>, wrap: boolean) {
    const request = new Request(`${CONTAINER_ORIGIN}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        provider: "test",
        client_id: "plat5",
        client_secret: "secret",
      }),
    });
    const res = await app.fetch(wrap ? applyPublicIssuerUrl(request) : request);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string };
    expect(json.access_token).toBeTruthy();
    return json.access_token;
  }

  async function jwksVerifier(app: ReturnType<typeof testApp>) {
    const res = await app.fetch(new Request(`${CONTAINER_ORIGIN}/.well-known/jwks.json`));
    expect(res.status).toBe(200);
    const jwks = (await res.json()) as JSONWebKeySet;
    return createLocalJWKSet(jwks);
  }

  test("real (non-/dev/token) JWT iss matches PUBLIC_ISSUER_URL when set", async () => {
    process.env.PUBLIC_ISSUER_URL = PUBLIC_ISSUER;
    const app = testApp();
    const token = await mintAccessToken(app, true);
    const JWKS = await jwksVerifier(app);

    const { payload } = await jwtVerify(token, JWKS, { issuer: PUBLIC_ISSUER });
    expect(payload.iss).toBe(PUBLIC_ISSUER);
    expect(payload.iss).not.toBe(CONTAINER_ORIGIN);
  });

  test("without PUBLIC_ISSUER_URL, iss is the request origin and AUTH_ISSUER verify fails", async () => {
    const app = testApp();
    const token = await mintAccessToken(app, true);
    const JWKS = await jwksVerifier(app);

    const { payload } = await jwtVerify(token, JWKS, { issuer: CONTAINER_ORIGIN });
    expect(payload.iss).toBe(CONTAINER_ORIGIN);

    await expect(jwtVerify(token, JWKS, { issuer: PUBLIC_ISSUER })).rejects.toThrow();
  });
});
