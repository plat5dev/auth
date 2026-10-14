import { ScryptHasher } from "@openauthjs/openauth/provider/password";
import { Storage, type StorageAdapter } from "@openauthjs/openauth/storage/storage";
import type { UsersStore } from "../db/users.ts";
import { devModeEnabled } from "./mode.ts";

export type DevUser = { email: string; password: string };

/**
 * Parses `AUTH_DEV_USERS`: comma-separated `email:password` pairs.
 * Emails are lowercased, like the password provider does. A pair without
 * both parts, or with a password under 8 characters, is an error: the login
 * form would refuse that password, so the seeded user could never sign in.
 */
export function parseDevUsers(raw: string | undefined): DevUser[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf(":");
      const email = (at < 0 ? pair : pair.slice(0, at)).trim().toLowerCase();
      const password = at < 0 ? "" : pair.slice(at + 1);
      if (!email.includes("@") || !password) {
        throw new Error(`AUTH_DEV_USERS: expected email:password, got "${email}"`);
      }
      if (password.length < 8) {
        throw new Error(`AUTH_DEV_USERS: password for ${email} must be at least 8 characters`);
      }
      return { email, password };
    });
}

export type SeedDevUsersDeps = {
  storage: StorageAdapter;
  users: Pick<UsersStore, "getOrCreateUser">;
};

/**
 * Dev-only: gives each `AUTH_DEV_USERS` email a password login, the same
 * record the register flow writes, and its user row. Runs at boot and sets
 * the password every time, so the env stays the truth. Off unless
 * `AUTH_DEV_MODE=true`. Returns the seeded emails.
 */
export async function seedDevUsers(
  env: Record<string, string | undefined>,
  deps: SeedDevUsersDeps,
): Promise<string[]> {
  const users = parseDevUsers(env.AUTH_DEV_USERS);
  if (users.length === 0) return [];
  if (!devModeEnabled(env)) {
    throw new Error("AUTH_DEV_USERS needs AUTH_DEV_MODE=true");
  }
  const hasher = ScryptHasher();
  for (const u of users) {
    await Storage.set(deps.storage, ["email", u.email, "password"], await hasher.hash(u.password));
    await deps.users.getOrCreateUser("password", u.email);
  }
  return users.map((u) => u.email);
}
