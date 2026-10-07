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
