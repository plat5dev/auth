import { describe, expect, test } from "bun:test";

import { resolveRequestId } from "./request-id.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("resolveRequestId", () => {
  test("accepts printable ASCII up to 128 characters", () => {
    expect(resolveRequestId("req-123_abc.XYZ/456")).toBe("req-123_abc.XYZ/456");
    const maxLen = "a".repeat(128);
    expect(resolveRequestId(maxLen)).toBe(maxLen);
    expect(resolveRequestId("  trimmed-id  ")).toBe("trimmed-id");
  });

  test("generates a UUID when missing, empty, or whitespace-only", () => {
    for (const value of [null, undefined, "", "   ", "\t\n"]) {
      expect(resolveRequestId(value)).toMatch(UUID_RE);
    }
  });

  test("rejects CR/LF, control chars, internal spaces, non-ASCII, and >128 chars", () => {
    const invalid = [
      "abc\r\nX-Injected: 1",
      "abc\ndef",
      "abc\rdef",
      "abc\x00def",
      "abc\x1fdef",
      "abc\x7fdef",
      "abc def",
      "req-é",
      "a".repeat(129),
    ];
    for (const value of invalid) {
      const resolved = resolveRequestId(value);
      expect(resolved).not.toBe(value);
      expect(resolved).toMatch(UUID_RE);
    }
  });
});
