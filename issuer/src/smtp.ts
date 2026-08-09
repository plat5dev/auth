import nodemailer from "nodemailer";
import { logger } from "./logger.ts";

const smtpLogger = logger.withScope("issuer.provider.password.email");

let smtpTransporter: nodemailer.Transporter | undefined;

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
    throw new Error("SMTP_HOST must be set to send email codes");
  }
  if (!user || !pass) {
    throw new Error("SMTP_USER and SMTP_PASS must be set to send email codes");
  }

  if (!Number.isFinite(port)) {
    throw new Error("SMTP_PORT must be a valid number");
  }

  const tlsInsecure = process.env.SMTP_TLS_INSECURE === "true";

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
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
