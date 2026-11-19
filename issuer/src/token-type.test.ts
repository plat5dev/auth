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

  test("strips Content-Length in both branches", async () => {
    const added = await withTokenType(
      post("/token"),
      new Response(JSON.stringify({ access_token: "a" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "20",
        },
      }),
    );
    expect(added.headers.get("Content-Length")).toBeNull();
    expect(await added.json()).toEqual({ access_token: "a", token_type: "Bearer" });

    const kept = await withTokenType(
      post("/token"),
      new Response(JSON.stringify({ access_token: "a", token_type: "DPoP" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "40",
        },
      }),
    );
    expect(kept.headers.get("Content-Length")).toBeNull();
    expect(await kept.json()).toEqual({ access_token: "a", token_type: "DPoP" });
  });

  test("passes through invalid JSON cleanly without throwing", async () => {
    const res = await withTokenType(
      post("/token"),
      new Response("{not valid json", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "15",
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBeNull();
    expect(await res.text()).toBe("{not valid json");
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
