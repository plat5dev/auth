import { describe, expect, test } from "bun:test";

import { tokenProperties } from "./token-properties.ts";

describe("tokenProperties", () => {
  test("user_id only by default", () => {
    expect(tokenProperties("u1", "a@example.com", {})).toEqual({ user_id: "u1" });
  });

  test("email only with the exact string true", () => {
    expect(tokenProperties("u1", "a@example.com", { AUTH_TOKEN_EMAIL: "true" })).toEqual({
      user_id: "u1",
      email: "a@example.com",
    });
    for (const value of ["1", "TRUE", "yes", ""]) {
      expect(tokenProperties("u1", "a@example.com", { AUTH_TOKEN_EMAIL: value })).toEqual({
        user_id: "u1",
      });
    }
  });
});
