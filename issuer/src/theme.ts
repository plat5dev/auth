import { readFileSync } from "node:fs";
import type { Theme } from "@openauthjs/openauth/ui/theme";

// Plat5's look (plat5.com): paper and ink, the blue bar, Inter. Light or dark follows
// the system. A theme file (AUTH_THEME_FILE) replaces all of it.

/** Inter, served by the issuer, for themes that want it: `font-family: "Inter Variable"`. */
export const INTER_FONT_FACE = `@font-face {
  font-family: "Inter Variable";
  src: url("/static/inter-latin.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}`;

export function defaultTheme(displayName: string): Theme {
  return {
    title: displayName,
    favicon: "/static/favicon.svg",
    logo: {
      light: "/static/wordmark.svg",
      dark: "/static/wordmark-dark.svg",
    },
    background: {
      light: "#f2f2ef",
      dark: "#0f1013",
    },
    primary: {
      light: "#2b33f5",
      dark: "#4a52ff",
    },
    font: {
      family: '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif',
    },
    radius: "sm",
    css: `${INTER_FONT_FACE}
:root { color-scheme: light dark; }
[data-component="logo"] { height: 2rem; margin-bottom: 0.5rem; }
[data-component="button"] { font-weight: 600; }
[data-component="link"] { text-decoration-thickness: 1px; }`,
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
