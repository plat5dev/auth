import { describe, expect, test } from "bun:test";
import { ScryptHasher } from "@openauthjs/openauth/provider/password";
import { MemoryStorage } from "@openauthjs/openauth/storage/memory";
import { Storage } from "@openauthjs/openauth/storage/storage";

import { parseDevUsers, seedDevUsers } from "./users.ts";

describe("parseDevUsers", () => {
  test("unset or blank is no users", () => {
    expect(parseDevUsers(undefined)).toEqual([]);
    expect(parseDevUsers(" ")).toEqual([]);
  });

  test("pairs, lowercased emails, colons allowed in the password", () => {
    expect(parseDevUsers("Dev@Example.com:password, staff@example.com:pass:word")).toEqual([
      { email: "dev@example.com", password: "password" },
      { email: "staff@example.com", password: "pass:word" },
    ]);
  });

  test("a pair without a password or email is an error", () => {
    expect(() => parseDevUsers("dev@example.com")).toThrow("email:password");
    expect(() => parseDevUsers("dev:password")).toThrow("email:password");
  });

  test("a password the login form would refuse is an error", () => {
    expect(() => parseDevUsers("dev@example.com:short")).toThrow("at least 8");
  });
});

describe("seedDevUsers", () => {
  function deps() {
    const created: string[] = [];
    return {
      created,
      storage: MemoryStorage(),
      users: {
        getOrCreateUser: async (_provider: string, email: string) => {
          created.push(email);
          return "01TESTUSERID00000000000000";
        },
      },
    };
  }

  test("writes a password the provider's hasher verifies, and the user row", async () => {
    const d = deps();
    const seeded = await seedDevUsers(
      { AUTH_DEV_MODE: "true", AUTH_DEV_USERS: "dev@example.com:password" },
      d,
    );
    expect(seeded).toEqual(["dev@example.com"]);
    expect(d.created).toEqual(["dev@example.com"]);
    const hash = await Storage.get<any>(d.storage, ["email", "dev@example.com", "password"]);
    expect(await ScryptHasher().verify("password", hash)).toBe(true);
    expect(await ScryptHasher().verify("wrong-password", hash)).toBe(false);
  });

  test("needs dev mode", async () => {
    await expect(
      seedDevUsers({ AUTH_DEV_USERS: "dev@example.com:password" }, deps()),
    ).rejects.toThrow("AUTH_DEV_MODE");
  });

  test("nothing to seed is a no-op without dev mode", async () => {
    expect(await seedDevUsers({}, deps())).toEqual([]);
  });
});
