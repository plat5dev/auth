import { describe, expect, test } from "bun:test";

import { withTokenType } from "./token-type.ts";

const ORIGIN = "http://localhost:5000";

function post(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST" });
}

describe("withTokenType", () => {
  test("adds Bearer to a /token success", async () => {
    const res = await withTokenType(
      post("/token"),
      Response.json({ access_token: "a", refresh_token: "r", expires_in: 60 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: "a",
      refresh_token: "r",
      expires_in: 60,
      token_type: "Bearer",
    });
  });

  test("keeps a token_type that is already there", async () => {
    const res = await withTokenType(
      post("/token"),
      Response.json({ access_token: "a", token_type: "DPoP" }),
    );
    expect(((await res.json()) as { token_type: string }).token_type).toBe("DPoP");
  });

  test("leaves errors alone", async () => {
    const error = Response.json({ error: "invalid_grant" }, { status: 400 });
    expect(await withTokenType(post("/token"), error)).toBe(error);
  });

  test("leaves other routes alone", async () => {
    const other = Response.json({ access_token: "a" });
    expect(await withTokenType(post("/dev/token"), other)).toBe(other);
    const get = Response.json({ access_token: "a" });
    expect(await withTokenType(new Request(`${ORIGIN}/token`), get)).toBe(get);
  });
});
