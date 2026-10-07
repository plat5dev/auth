import nodemailer from "nodemailer";
import { ConfigError } from "./errors.ts";
import { logger } from "./logger.ts";

const smtpLogger = logger.withScope("issuer.provider.password.email");

let smtpTransporter: nodemailer.Transporter | undefined;

/**
 * Fail fast when SMTP_HOST is unreachable. Nodemailer's defaults (2 min connect,
 * 30 s greeting, 10 min socket) leave the sign-in request hanging.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 30_000;

export function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
  );
}

export function getSmtpTransporter() {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    throw new ConfigError("SMTP_HOST must be set to send email codes");
  }
  if (!user || !pass) {
    throw new ConfigError("SMTP_USER and SMTP_PASS must be set to send email codes");
  }

  if (!Number.isFinite(port)) {
    throw new ConfigError("SMTP_PORT must be a valid number");
  }

  const tlsInsecure = process.env.SMTP_TLS_INSECURE === "true";

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: !tlsInsecure,
    },
  });

  smtpLogger.info("SMTP transport configured", { host, port });
  return smtpTransporter;
}

export function getSmtpFrom() {
  return process.env.SMTP_FROM ?? "noreply@plat5.test";
}
