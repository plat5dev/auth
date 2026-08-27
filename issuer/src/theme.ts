import { readFileSync } from "node:fs";
import type { Theme } from "@openauthjs/openauth/ui/theme";

const DEFAULT_LOGO = "/static/logo.jpg";
const DEFAULT_FAVICON = "/static/p5.jpg";

export function defaultTheme(displayName: string): Theme {
  return {
    title: displayName,
    favicon: DEFAULT_FAVICON,
    logo: {
      light: DEFAULT_LOGO,
      dark: DEFAULT_LOGO,
    },
    background: {
      light: "#ffffff",
      dark: "#ffffff",
    },
    primary: {
      light: "#000000",
      dark: "#000000",
    },
    radius: "md",
    css: `
    :root { color-scheme: light; }
    body { color: #000; background: #fff; }
  `,
  };
}

export function loadTheme(opts: {
  displayName: string;
  themeFile?: string | null;
  readFile?: (path: string) => string;
}): Theme {
  const displayName = opts.displayName;
  const path = opts.themeFile?.trim() ?? "";
  if (!path) return defaultTheme(displayName);

  const read = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  let raw: string;
  try {
    raw = read(path);
  } catch {
    throw new Error(`AUTH_THEME_FILE: cannot read ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AUTH_THEME_FILE: invalid JSON (${path})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`AUTH_THEME_FILE: must be a JSON object (${path})`);
  }

  const theme = parsed as Theme;
  const title = typeof theme.title === "string" ? theme.title.trim() : "";
  if (!title) theme.title = displayName;
  return theme;
}

export function verificationEmail(
  displayName: string,
  code: string,
): { subject: string; text: string } {
  return {
    subject: `Your ${displayName} verification code`,
    text: `Your ${displayName} verification code is ${code}.`,
  };
}
