import { describe, expect, test } from "bun:test";

import { redactQuery } from "./redact.ts";

describe("redactQuery", () => {
  test("redacts the standard keys' values and keeps the keys", () => {
    for (const key of [
      "sig",
      "Signature",
      "AWSAccessKeyId",
      "X-Amz-Signature",
      "X-Amz-Credential",
      "X-Amz-Security-Token",
      "X-Goog-Signature",
    ]) {
      expect(redactQuery(`a=1&${key}=secret&b=2`)).toBe(`a=1&${key}=REDACTED&b=2`);
    }
  });

  test("keys match exactly, case-sensitive", () => {
    expect(redactQuery("SIG=x&signature=y&sigs=z")).toBe("SIG=x&signature=y&sigs=z");
  });

  test("keeps every other key and value as sent, a key without a value too", () => {
    expect(redactQuery("client_id=plat5&redirect_uri=http%3A%2F%2Fx&sig&state=")).toBe(
      "client_id=plat5&redirect_uri=http%3A%2F%2Fx&sig&state=",
    );
  });
});
