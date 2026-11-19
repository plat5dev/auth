import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import type { Sql } from "../db/pool.ts";
import { escapeLikePattern, keyNamespace, PostgresStorage } from "./postgres.ts";

const SEP = String.fromCharCode(0x1f);

/** Evaluate SQL `LIKE pattern ESCAPE '\'` in JS to simulate Postgres matching. */
function matchSqlLike(value: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) {
      regex += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") {
      regex += ".*";
    } else if (ch === "_") {
      regex += ".";
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regex += "$";
  return new RegExp(regex, "s").test(value);
}

function makeFakeSql(
  handler: (query: string, params: unknown[]) => unknown[] | Promise<unknown[]>,
): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    return Promise.resolve(handler(query, values));
  };
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn as unknown as Sql;
}

describe("escapeLikePattern and keyNamespace", () => {
  test("escapes backslash, percent, and underscore", () => {
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    expect(escapeLikePattern("plain")).toBe("plain");
  });

  test("keyNamespace returns only the first segment", () => {
    expect(keyNamespace(["oauth:code", "secret-code-123"])).toBe("oauth:code");
    expect(keyNamespace(["email", "alice@example.com", "password"])).toBe("email");
    expect(keyNamespace([])).toBe("");
  });
});

describe("PostgresStorage telemetry, logging, and span lifecycle", () => {
  let exporter: InMemorySpanExporter;
  let tracerProvider: BasicTracerProvider;
  let lines: Record<string, unknown>[];
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    trace.disable();
    tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(tracerProvider);

    lines = [];
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        lines.push(JSON.parse(String(chunk)));
        return true;
      },
    );
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    trace.disable();
    await tracerProvider.shutdown();
  });

  test("never leaks secret key segments or emails into spans or logs, and ends every span", async () => {
    const secretCode = "super-secret-oauth-code-999";
    const secretRefresh = "refresh-token-xyz-789";
    const userEmail = "alice.secret@example.com";

    const sql = makeFakeSql(() => []);
    const storage = new PostgresStorage(sql);

    await storage.get(["oauth:code", secretCode]);
    await storage.set(["oauth:refresh", "user:1", secretRefresh], { ok: true });
    await storage.remove(["email", userEmail, "password"]);
    for await (const _ of storage.scan(["email", userEmail])) {
      // no rows
    }
    await storage.purgeExpired();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.name)).toEqual([
      "openauth_kv.get",
      "openauth_kv.set",
      "openauth_kv.remove",
      "openauth_kv.scan",
      "openauth_kv.purge_expired",
    ]);
    expect(spans[0]?.attributes["db.key"]).toBe("oauth:code");
    expect(spans[1]?.attributes["db.key"]).toBe("oauth:refresh");
    expect(spans[2]?.attributes["db.key"]).toBe("email");
    expect(spans[3]?.attributes["db.prefix"]).toBe("email");

    const serializedSpans = JSON.stringify(spans.map((s) => s.attributes));
    expect(serializedSpans).not.toContain(secretCode);
    expect(serializedSpans).not.toContain(secretRefresh);
    expect(serializedSpans).not.toContain(userEmail);

    // No noisy info log on scan
    expect(lines).toHaveLength(0);
  });

  test("error logs on set and scan only contain coarse namespace, never secrets/emails", async () => {
    const secretToken = "top-secret-token-abc";
    const userEmail = "bob.private@example.com";

    const failingSql = makeFakeSql(() => {
      throw new Error("connection lost");
    });
    const storage = new PostgresStorage(failingSql);

    await expect(
      storage.set(["oauth:refresh", secretToken], { x: 1 }),
    ).rejects.toThrow("connection lost");

    const drainScan = async () => {
      for await (const _ of storage.scan(["email", userEmail])) {
        // unreachable
      }
    };
    await expect(drainScan()).rejects.toThrow("connection lost");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "OpenAuth storage set failed",
      db_key: "oauth:refresh",
    });
    expect(lines[1]).toMatchObject({
      level: "error",
      message: "OpenAuth storage scan failed",
      db_prefix: "email",
    });

    const serializedLogs = JSON.stringify(lines);
    expect(serializedLogs).not.toContain(secretToken);
    expect(serializedLogs).not.toContain(userEmail);
  });
});

describe("PostgresStorage.scan LIKE escaping and segment boundary", () => {
  const rows = [
    { key_path: ["a"].join(SEP), value: { id: "exact-a" } },
    { key_path: ["a", "child"].join(SEP), value: { id: "child-a" } },
    { key_path: ["ab"].join(SEP), value: { id: "sibling-ab" } },
    { key_path: ["ab", "child"].join(SEP), value: { id: "sibling-ab-child" } },
    { key_path: ["email", "a_b%c\\d", "pw"].join(SEP), value: { id: "literal-wildcards" } },
    { key_path: ["email", "axbZZZc\\d", "pw"].join(SEP), value: { id: "non-matching-wildcards" } },
  ];

  function createScanStorage() {
    const queries: Array<{ query: string; params: unknown[] }> = [];
    const sql = makeFakeSql((query, params) => {
      queries.push({ query, params });
      if (params.length === 0) {
        return rows;
      }
      const [exactPrefix, likePattern] = params as [string, string];
      return rows.filter(
        (row) =>
          row.key_path === exactPrefix ||
          matchSqlLike(row.key_path, likePattern),
      );
    });
    return { storage: new PostgresStorage(sql), queries };
  }

  test("enforces segment boundary so ['a'] does not match ['ab']", async () => {
    const { storage, queries } = createScanStorage();
    const matched: Array<[string[], unknown]> = [];
    for await (const entry of storage.scan(["a"])) {
      matched.push(entry);
    }

    expect(queries[0]?.query).toContain("ESCAPE '\\'");
    expect(matched).toEqual([
      [["a"], { id: "exact-a" }],
      [["a", "child"], { id: "child-a" }],
    ]);
  });

  test("escapes LIKE wildcards %, _, and \\ in prefix segments", async () => {
    const { storage, queries } = createScanStorage();
    const matched: Array<[string[], unknown]> = [];
    for await (const entry of storage.scan(["email", "a_b%c\\d"])) {
      matched.push(entry);
    }

    expect(queries[0]?.params[1]).toBe(`email${SEP}a\\_b\\%c\\\\d${SEP}%`);
    expect(matched).toEqual([
      [["email", "a_b%c\\d", "pw"], { id: "literal-wildcards" }],
    ]);
  });

  test("empty prefix matches all keys", async () => {
    const { storage } = createScanStorage();
    const matched: Array<[string[], unknown]> = [];
    for await (const entry of storage.scan([])) {
      matched.push(entry);
    }
    expect(matched).toHaveLength(rows.length);
  });
});
