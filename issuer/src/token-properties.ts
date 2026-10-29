/**
 * The access token's subject properties. Always `user_id`. `email` only when
 * `AUTH_TOKEN_EMAIL=true` (exact string): for an operator issuer, whose relying
 * party records who acted. A customer issuer leaves it off, so customer
 * tokens carry no email.
 */
export type TokenProperties = { user_id: string; email?: string };

export function tokenEmailEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AUTH_TOKEN_EMAIL === "true";
}

export function tokenProperties(
  userId: string,
  email: string,
  env: Record<string, string | undefined> = process.env,
): TokenProperties {
  return tokenEmailEnabled(env) ? { user_id: userId, email } : { user_id: userId };
}
