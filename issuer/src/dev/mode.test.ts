import { describe, expect, test } from "bun:test";

import { logDevModeStartup } from "./mode.ts";

function capture() {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    info,
    warn,
    log: {
      info: (message: string) => {
        info.push(message);
      },
      warn: (message: string) => {
        warn.push(message);
      },
    },
  };
}

describe("AUTH_DEV_MODE startup", () => {
  test("exact true warns once and does not say dev mode is off", () => {
    const c = capture();
    logDevModeStartup({ AUTH_DEV_MODE: "true" }, c.log);
    expect(c.warn).toHaveLength(1);
    expect(c.info).toHaveLength(0);
    expect(c.warn[0]).toContain("AUTH_DEV_MODE=true");
  });

  test("any other value logs one info line and does not enable dev mode", () => {
    for (const value of ["TRUE", "True", "1", "yes", " true", ""]) {
      const c = capture();
      logDevModeStartup({ AUTH_DEV_MODE: value }, c.log);
      expect(c.warn).toHaveLength(0);
      expect(c.info).toEqual([
        'AUTH_DEV_MODE is set but dev mode is off; only the exact string "true" enables it',
      ]);
    }
  });

  test("unset logs nothing", () => {
    const c = capture();
    logDevModeStartup({}, c.log);
    expect(c.info).toHaveLength(0);
    expect(c.warn).toHaveLength(0);
  });
});
