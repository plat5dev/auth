import { describe, expect, test } from "bun:test";

import { authorizeStartLocation } from "./authorize-start.ts";

const ORIGIN = "http://localhost:5000";

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`);
}

describe("authorizeStartLocation", () => {
  test("prompt=create rewrites /{provider}/authorize to /{provider}/register", () => {
    expect(
      authorizeStartLocation(
        get("/authorize?client_id=plat5&prompt=create"),
        "/password/authorize",
      ),
    ).toBe("/password/register");
  });

  test("rewrites an absolute Location, preserving origin", () => {
    expect(
      authorizeStartLocation(
        get("/authorize?prompt=create"),
        `${ORIGIN}/password/authorize`,
      ),
    ).toBe(`${ORIGIN}/password/register`);
  });

  test("create among space-separated prompt values still rewrites", () => {
    expect(
      authorizeStartLocation(
        get("/authorize?prompt=login%20create"),
        "/password/authorize",
      ),
    ).toBe("/password/register");
  });

  test("no prompt leaves Location unchanged", () => {
    expect(
      authorizeStartLocation(get("/authorize?client_id=plat5"), "/password/authorize"),
    ).toBe("/password/authorize");
  });

  test("other prompt values are ignored", () => {
    expect(
      authorizeStartLocation(get("/authorize?prompt=login"), "/password/authorize"),
    ).toBe("/password/authorize");
  });

  test("does not rewrite non-provider-login Locations", () => {
    const req = get("/authorize?prompt=create");
    expect(authorizeStartLocation(req, "/authorize")).toBe("/authorize");
    expect(authorizeStartLocation(req, "/password/callback")).toBe("/password/callback");
    expect(authorizeStartLocation(req, "/password/authorize/extra")).toBe(
      "/password/authorize/extra",
    );
  });

  test("only GET/HEAD /authorize", () => {
    expect(
      authorizeStartLocation(
        new Request(`${ORIGIN}/authorize?prompt=create`, { method: "POST" }),
        "/password/authorize",
      ),
    ).toBe("/password/authorize");
    expect(
      authorizeStartLocation(get("/token?prompt=create"), "/password/authorize"),
    ).toBe("/password/authorize");
  });

  test("null Location stays null", () => {
    expect(authorizeStartLocation(get("/authorize?prompt=create"), null)).toBeNull();
  });
});
