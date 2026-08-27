import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultTheme, loadTheme, verificationEmail } from "./theme.ts";

const DISPLAY = "Plat5";

describe("loadTheme", () => {
  test("omitted file uses today's light defaults and display name title", () => {
    const theme = loadTheme({ displayName: DISPLAY });
    expect(theme).toEqual(defaultTheme(DISPLAY));
    expect(theme.title).toBe(DISPLAY);
    expect(theme.favicon).toBe("/static/p5.jpg");
    expect(theme.logo).toEqual({ light: "/static/logo.jpg", dark: "/static/logo.jpg" });
  });

  test("empty AUTH_THEME_FILE is omitted", () => {
    const theme = loadTheme({ displayName: DISPLAY, themeFile: "  " });
    expect(theme.title).toBe(DISPLAY);
    expect(theme.favicon).toBe("/static/p5.jpg");
  });

  test("file with title is login UI only; email still uses AUTH_DISPLAY_NAME", () => {
    const theme = loadTheme({
      displayName: DISPLAY,
      themeFile: "/config/theme.json",
      readFile: () =>
        JSON.stringify({
          title: "Acme",
          primary: "#111111",
          logo: { light: "/acme-light.svg", dark: "/acme-dark.svg" },
        }),
    });
    expect(theme.title).toBe("Acme");
    expect(theme.primary).toBe("#111111");
    expect(theme.logo).toEqual({ light: "/acme-light.svg", dark: "/acme-dark.svg" });
    const email = verificationEmail(DISPLAY, "123456");
    expect(email.subject).toBe("Your Plat5 verification code");
    expect(email.text).toBe("Your Plat5 verification code is 123456.");
    expect(email.subject.includes("Acme")).toBe(false);
    expect(email.text.includes("Acme")).toBe(false);
  });

  test("file without title fills theme.title from AUTH_DISPLAY_NAME", () => {
    const theme = loadTheme({
      displayName: DISPLAY,
      themeFile: "/config/theme.json",
      readFile: () => JSON.stringify({ radius: "full", primary: "#ff5e00" }),
    });
    expect(theme.title).toBe(DISPLAY);
    expect(theme.radius).toBe("full");
    expect(theme.primary).toBe("#ff5e00");
  });

  test("blank title in file fills from AUTH_DISPLAY_NAME", () => {
    const theme = loadTheme({
      displayName: DISPLAY,
      themeFile: "/config/theme.json",
      readFile: () => JSON.stringify({ title: "  " }),
    });
    expect(theme.title).toBe(DISPLAY);
  });

  test("passes through extra keys", () => {
    const theme = loadTheme({
      displayName: DISPLAY,
      themeFile: "/config/theme.json",
      readFile: () => JSON.stringify({ title: "X", extra: true, css: "body{}" }),
    }) as { extra?: boolean; css?: string; title?: string };
    expect(theme.extra).toBe(true);
    expect(theme.css).toBe("body{}");
  });

  test("invalid JSON fails closed", () => {
    expect(() =>
      loadTheme({
        displayName: DISPLAY,
        themeFile: "/config/theme.json",
        readFile: () => "{not json",
      }),
    ).toThrow(/invalid JSON/);
  });

  test("non-object JSON fails closed", () => {
    expect(() =>
      loadTheme({
        displayName: DISPLAY,
        themeFile: "/config/theme.json",
        readFile: () => "[]",
      }),
    ).toThrow(/JSON object/);
  });

  test("missing file fails closed", () => {
    expect(() =>
      loadTheme({
        displayName: DISPLAY,
        themeFile: "/no/such/theme.json",
        readFile: () => {
          throw new Error("ENOENT");
        },
      }),
    ).toThrow(/cannot read/);
  });

  test("reads a real file", () => {
    const dir = mkdtempSync(join(tmpdir(), "auth-theme-"));
    const path = join(dir, "theme.json");
    writeFileSync(path, JSON.stringify({ title: "FromDisk", radius: "sm" }));
    const theme = loadTheme({ displayName: DISPLAY, themeFile: path });
    expect(theme.title).toBe("FromDisk");
    expect(theme.radius).toBe("sm");
  });
});
