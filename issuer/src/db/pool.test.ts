import { describe, expect, test } from "bun:test";

import { connect } from "./pool.ts";

describe("connect", () => {
  test("fails fast when DATABASE_URL is unset or blank", () => {
    expect(() => connect({})).toThrow("DATABASE_URL must be set");
    expect(() => connect({ DATABASE_URL: "" })).toThrow("DATABASE_URL must be set");
    expect(() => connect({ DATABASE_URL: "   " })).toThrow("DATABASE_URL must be set");
  });
});
