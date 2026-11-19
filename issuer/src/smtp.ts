import nodemailer from "nodemailer";
import { ConfigError } from "./errors.ts";
import { logger } from "./logger.ts";


let smtpTransporter: nodemailer.Transporter | undefined;

/**
 * Fail fast when SMTP_HOST is unreachable. Nodemailer's defaults (2 min connect,
 * 30 s greeting, 10 min socket) leave the sign-in request hanging.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 30_000;

export function parseSmtpPort(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return 587;
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("SMTP_PORT must be a valid port number");
  }
  return port;
}

export function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS,
  );
}

export function getSmtpTransporter() {
  if (smtpTransporter) {
    return smtpTransporter;
  }

  const host = process.env.SMTP_HOST?.trim();
  const port = parseSmtpPort(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host) {
    throw new ConfigError("SMTP_HOST must be set to send email codes");
  }
  if (!user || !pass) {
    throw new ConfigError("SMTP_USER and SMTP_PASS must be set to send email codes");
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

  logger.info("SMTP transport configured", { host, port });
  return smtpTransporter;
}

export function getSmtpFrom() {
  const raw = process.env.SMTP_FROM?.trim();
  return raw ? raw : "noreply@plat5.test";
}
