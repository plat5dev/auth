import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { logger } from "./logger.ts";

describe("logger", () => {
  let lines: string[] = [];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    lines = [];
    spy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk).trimEnd());
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  test("one JSON line on stdout per call: timestamp, lowercase level, message, then the fields", () => {
    logger.debug("d");
    logger.info("request completed", { route: "/token", status: 200 });
    logger.warn("w");
    logger.error("e");
    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    expect(Object.keys(parsed[1])).toEqual(["timestamp", "level", "message", "route", "status"]);
    expect(parsed[1].message).toBe("request completed");
    expect(parsed[3]).not.toHaveProperty("error_type");
  });

  test("an error adds error_type (internal unless given), error_message and its stack", () => {
    logger.error("failed", new Error("boom"));
    logger.error("db failed", new Error("down"), { error_type: "db" });
    logger.error("odd", "not an Error");
    const [a, b, c] = lines.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ level: "error", error_type: "internal", error_message: "boom" });
    expect(a.stack).toContain("boom");
    expect(b).toMatchObject({ error_type: "db", error_message: "down" });
    expect(c).toMatchObject({ error_type: "internal", error_message: "not an Error" });
    expect(c).not.toHaveProperty("stack");
    expect(lines.join("\n")).not.toContain("error_kind");
    expect(lines.join("\n")).not.toContain('"scope"');
  });
});
