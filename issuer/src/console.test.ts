import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { OauthError } from "@openauthjs/openauth/error";

import { suppressRawTrace } from "./client-error.ts";
import { installConsoleCapture } from "./console.ts";

describe("installConsoleCapture", () => {
  let out: string[] = [];
  let spy: ReturnType<typeof spyOn>;
  const target = {} as Console;
  beforeEach(() => {
    out = [];
    spy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    installConsoleCapture(target);
  });
  afterEach(() => spy.mockRestore());

  const lines = () => out.join("").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

  test("Hono's request logger lines are dropped", () => {
    target.log("<-- POST /token");
    target.log("--> POST /token \u001b[32m200\u001b[0m 6ms");
    expect(out).toEqual([]);
  });

  test("other writes are JSON lines at their level", () => {
    target.log("plain %s", "text");
    target.warn("careful");
    target.error("failed to decrypt", "key", new Error("bad tag"));
    const [a, b, c] = lines();
    expect(a).toMatchObject({ level: "info", message: "plain text" });
    expect(b).toMatchObject({ level: "warn", message: "careful" });
    expect(c).toMatchObject({
      level: "error",
      message: "failed to decrypt key",
      error_type: "internal",
      error_message: "bad tag",
    });
  });

  test("a protocol error is an info line; the suppressed generic error is dropped", () => {
    target.error(new OauthError("invalid_request", "Missing parameter: client_id"));
    const safe = new Error("An unexpected error occurred.");
    suppressRawTrace(safe);
    target.error(safe);
    const parsed = lines();
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      level: "info",
      message: "OAuth error response",
      oauth_error: "invalid_request",
    });
    expect(parsed[0]).not.toHaveProperty("error_type");
  });
});
