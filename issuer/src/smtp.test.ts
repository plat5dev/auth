import { afterEach, describe, expect, test } from "bun:test";

import { ConfigError } from "./errors.ts";
import { getSmtpFrom, parseSmtpPort } from "./smtp.ts";

const savedFrom = process.env.SMTP_FROM;

afterEach(() => {
  if (savedFrom === undefined) delete process.env.SMTP_FROM;
  else process.env.SMTP_FROM = savedFrom;
});

describe("SMTP env edge cases", () => {
  test("parseSmtpPort treats unset, empty, and whitespace-only as 587", () => {
    expect(parseSmtpPort(undefined)).toBe(587);
    expect(parseSmtpPort("")).toBe(587);
    expect(parseSmtpPort("   ")).toBe(587);
    expect(parseSmtpPort(" 465 ")).toBe(465);
  });

  test("parseSmtpPort rejects invalid or out-of-range ports", () => {
    for (const bad of ["0", "-1", "70000", "abc", "587.5"]) {
      expect(() => parseSmtpPort(bad)).toThrow(ConfigError);
    }
  });

  test("getSmtpFrom treats empty and whitespace-only as default", () => {
    delete process.env.SMTP_FROM;
    expect(getSmtpFrom()).toBe("noreply@plat5.test");

    process.env.SMTP_FROM = "";
    expect(getSmtpFrom()).toBe("noreply@plat5.test");

    process.env.SMTP_FROM = "   ";
    expect(getSmtpFrom()).toBe("noreply@plat5.test");

    process.env.SMTP_FROM = "  auth@example.com  ";
    expect(getSmtpFrom()).toBe("auth@example.com");
  });
});
