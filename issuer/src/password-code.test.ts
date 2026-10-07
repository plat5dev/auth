import { describe, expect, test } from "bun:test";

import { createSendCode, SMTP_REQUIRED_MESSAGE, type SendCodeDeps } from "./password-code.ts";

const CODE = "123456";
const EMAIL = "someone@plat5.test";

function harness(smtp: boolean) {
  const lines: string[] = [];
  const sent: Array<{ email: string; code: string }> = [];
  const record = (message: string, ...rest: unknown[]) => {
    lines.push(JSON.stringify([message, ...rest.map((r) => (r instanceof Error ? r.message : r))]));
  };
  const deps: SendCodeDeps = {
    smtpConfigured: () => smtp,
    sendEmail: async (email, code) => {
      sent.push({ email, code });
    },
    logger: { info: record, error: record },
  };
  return { deps, lines, sent };
}

describe("login code delivery", () => {
  test("dev mode off + incomplete SMTP: send fails and the code is not logged", async () => {
    for (const env of [
      {},
      { AUTH_DEV_MODE: "1" },
      { DEPLOYMENT_ENV: "docker" },
      { DEPLOYMENT_ENV: "production" },
      { DEPLOYMENT_ENV: "prod" },
    ]) {
      const h = harness(false);
      await expect(createSendCode(env, h.deps)(EMAIL, CODE)).rejects.toThrow(SMTP_REQUIRED_MESSAGE);
      expect(h.sent).toHaveLength(0);
      expect(h.lines.join("\n")).not.toContain(CODE);
    }
  });

  test("AUTH_DEV_MODE=true + incomplete SMTP: code is logged, not emailed", async () => {
    const h = harness(false);
    await createSendCode({ AUTH_DEV_MODE: "true" }, h.deps)(EMAIL, CODE);
    expect(h.sent).toHaveLength(0);
    expect(h.lines.join("\n")).toContain(CODE);
  });

  test("SMTP configured: code is emailed and never logged, with or without dev mode", async () => {
    for (const env of [{}, { AUTH_DEV_MODE: "true" }]) {
      const h = harness(true);
      await createSendCode(env, h.deps)(EMAIL, CODE);
      expect(h.sent).toEqual([{ email: EMAIL, code: CODE }]);
      expect(h.lines.join("\n")).not.toContain(CODE);
    }
  });
});
