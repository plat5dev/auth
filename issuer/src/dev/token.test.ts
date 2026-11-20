import { describe, expect, test } from "bun:test";
import { MemoryStorage } from "@openauthjs/openauth/storage/memory";
import { decodeJwt } from "jose";

import { devModeEnabled } from "./mode.ts";
import { createDevTokenHandler, type DevTokenDeps } from "./token.ts";

const USER_ID = "01TESTUSERID00000000000000";

function deps(): DevTokenDeps {
  return {
    storage: MemoryStorage(),
    users: { getOrCreateUser: async () => USER_ID },
    allowedClients: ["plat5"],
  };
}

function mintRequest() {
  return new Request("http://127.0.0.1:5000/dev/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e-a@plat5.test" }),
  });
}

describe("AUTH_DEV_MODE gate on /dev/token", () => {
  test("unset: /dev/token is not registered", () => {
    expect(devModeEnabled({})).toBe(false);
    expect(createDevTokenHandler({}, deps())).toBeNull();
  });

  test("only the exact string true enables it", () => {
    for (const value of ["", "1", "TRUE", "True", "yes", " true"]) {
      expect(createDevTokenHandler({ AUTH_DEV_MODE: value }, deps())).toBeNull();
    }
  });

  test("true: /dev/token mints an access token", async () => {
    const handler = createDevTokenHandler({ AUTH_DEV_MODE: "true" }, deps());
    expect(handler).not.toBeNull();
    const res = await handler!(mintRequest(), "req-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; user_id: string };
    expect(body.user_id).toBe(USER_ID);
    const claims = decodeJwt(body.access_token);
    expect(claims.aud).toBe("plat5");
    expect((claims.properties as { user_id: string }).user_id).toBe(USER_ID);
  });

  test("trims and validates PUBLIC_ISSUER_URL", async () => {
    const handler = createDevTokenHandler(
      { AUTH_DEV_MODE: "true", PUBLIC_ISSUER_URL: "  https://auth.example.com/  " },
      deps(),
    );
    const res = await handler!(mintRequest(), "req-2");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(decodeJwt(body.access_token).iss).toBe("https://auth.example.com");

    expect(() =>
      createDevTokenHandler(
        { AUTH_DEV_MODE: "true", PUBLIC_ISSUER_URL: "ftp://bad.example.com" },
        deps(),
      ),
    ).toThrow("Invalid PUBLIC_ISSUER_URL");
    expect(() =>
      createDevTokenHandler(
        { AUTH_DEV_MODE: "true", PUBLIC_ISSUER_URL: "not-a-url" },
        deps(),
      ),
    ).toThrow("Invalid PUBLIC_ISSUER_URL");
  });

  test("defaults client_id to the first allowed client when omitted", async () => {
    const handler = createDevTokenHandler(
      { AUTH_DEV_MODE: "true" },
      { ...deps(), allowedClients: ["operator-console", "cli"] },
    );
    const res = await handler!(mintRequest(), "req-3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(decodeJwt(body.access_token).aud).toBe("operator-console");
  });

  test("lists allowed client_ids in 422 when client_id is not allowed", async () => {
    const handler = createDevTokenHandler(
      { AUTH_DEV_MODE: "true" },
      { ...deps(), allowedClients: ["operator-console", "cli"] },
    );
    const req = new Request("http://127.0.0.1:5000/dev/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "op@plat5.test", client_id: "plat5" }),
    });
    const res = await handler!(req, "req-4");
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe(
      "client_id not allowed: plat5 (allowed: operator-console, cli)",
    );
  });
});
