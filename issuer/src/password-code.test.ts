import { afterEach, describe, expect, test } from "bun:test";
import { metrics } from "@opentelemetry/api";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

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
    for (const env of [{}, { AUTH_DEV_MODE: "1" }]) {
      const h = harness(false);
      await expect(createSendCode(env, h.deps)(EMAIL, CODE)).rejects.toThrow(SMTP_REQUIRED_MESSAGE);
      expect(h.sent).toHaveLength(0);
      const logged = h.lines.join("\n");
      expect(logged).not.toContain(CODE);
      expect(logged).toContain('"error_type":"internal"');
      expect(logged).not.toContain('"error_type":"network"');
    }
  });

  test("AUTH_DEV_MODE=true + incomplete SMTP: code is logged, not emailed", async () => {
    const h = harness(false);
    await createSendCode({ AUTH_DEV_MODE: "true" }, h.deps)(EMAIL, CODE);
    expect(h.sent).toHaveLength(0);
    expect(h.lines.join("\n")).toContain(CODE);
  });

  test("email send failure stays a network error", async () => {
    const h = harness(true);
    h.deps.sendEmail = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    await expect(createSendCode({}, h.deps)(EMAIL, CODE)).rejects.toThrow("ECONNREFUSED");
    const logged = h.lines.join("\n");
    expect(logged).toContain('"error_type":"network"');
    expect(logged).not.toContain('"error_type":"internal"');
    expect(logged).not.toContain(CODE);
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

describe("auth_password_codes_total metric", () => {
  let provider: MeterProvider | undefined;

  afterEach(async () => {
    metrics.disable();
    await provider?.shutdown();
    provider = undefined;
  });

  test("records counts after metrics.setGlobalMeterProvider is installed", async () => {
    metrics.disable();
    const prometheus = new PrometheusExporter({ preventServerStart: true });
    provider = new MeterProvider({ readers: [prometheus] });
    metrics.setGlobalMeterProvider(provider);

    const logHarness = harness(false);
    await createSendCode({ AUTH_DEV_MODE: "true" }, logHarness.deps)(EMAIL, CODE);

    const emailHarness = harness(true);
    await createSendCode({}, emailHarness.deps)(EMAIL, CODE);

    const { resourceMetrics } = await prometheus.collect();
    const text = new PrometheusSerializer("", false).serialize(resourceMetrics);
    expect(text).toMatch(/auth_password_codes_total\{[^}]*delivery_method="log"[^}]*\} 1/);
    expect(text).toMatch(/auth_password_codes_total\{[^}]*delivery_method="email"[^}]*\} 1/);
  });
});
