/**
 * `AUTH_DEV_MODE` gates every dev-only convenience in the issuer:
 * - `POST /dev/token` (mints a valid token for any email)
 * - logging one-time login codes when SMTP is not fully configured
 *
 * Both let anyone sign in as anyone, so dev mode is opt-in: only the exact
 * string `true` enables it. `DEPLOYMENT_ENV` has no effect on it.
 */
export function devModeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AUTH_DEV_MODE === "true";
}

const DEV_MODE_ON =
  "AUTH_DEV_MODE=true: POST /dev/token is enabled and login codes are logged when SMTP is incomplete (anyone can sign in as anyone; never enable in production)";

const DEV_MODE_OFF =
  'AUTH_DEV_MODE is set but dev mode is off; only the exact string "true" enables it';

type DevModeLog = {
  info(message: string): void;
  warn(message: string): void;
};

/** One startup line: warn when dev mode is on, info when the var is set to anything else. */
export function logDevModeStartup(
  env: Record<string, string | undefined>,
  log: DevModeLog,
): void {
  if (devModeEnabled(env)) {
    log.warn(DEV_MODE_ON);
    return;
  }
  if (env.AUTH_DEV_MODE !== undefined) {
    log.info(DEV_MODE_OFF);
  }
}
