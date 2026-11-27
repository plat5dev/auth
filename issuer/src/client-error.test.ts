import { describe, expect, test } from "bun:test";
import {
  MissingParameterError,
  OauthError,
  UnauthorizedClientError,
  UnknownStateError,
} from "@openauthjs/openauth/error";

import {
  filterConsoleErrorArgs,
  installClientErrorBoundary,
  suppressRawTrace,
  toClientError,
} from "./client-error.ts";
import {
  ConfigError,
  ErrorType,
  SIGNUP_UNAVAILABLE_MESSAGE,
  UNEXPECTED_CLIENT_MESSAGE,
  markErrorLogged,
} from "./errors.ts";
import { SMTP_REQUIRED_MESSAGE } from "./password-code.ts";

type Logged = {
  message: string;
  error?: unknown;
  attributes?: Record<string, unknown>;
};

function captureLog() {
  const entries: Logged[] = [];
  return {
    entries,
    log: {
      error(message: string, error?: unknown, attributes?: Record<string, unknown>) {
        entries.push({ message, error, attributes });
        if (error instanceof Error) markErrorLogged(error);
      },
    },
  };
}

describe("toClientError", () => {
  test("config errors: one internal log, generic client message, no raw trace", () => {
    const cap = captureLog();
    const err = new ConfigError(SMTP_REQUIRED_MESSAGE);
    const printed: unknown[][] = [];
    const safe = toClientError(err, cap.log);
    filterConsoleErrorArgs([safe], (...args) => {
      printed.push(args);
    });
    filterConsoleErrorArgs([err], (...args) => {
      printed.push(args);
    });

    expect(safe.message).toBe(SIGNUP_UNAVAILABLE_MESSAGE);
    expect(safe.message).not.toContain("SMTP_");
    expect(safe.message).not.toContain("AUTH_DEV_MODE");
    expect(cap.entries).toHaveLength(1);
    expect(cap.entries[0]?.attributes?.error_type).toBe(ErrorType.Internal);
    expect((cap.entries[0]?.error as Error).message).toBe(SMTP_REQUIRED_MESSAGE);
    expect(printed).toEqual([[err]]);

    const again = toClientError(err, cap.log);
    expect(again.message).toBe(SIGNUP_UNAVAILABLE_MESSAGE);
    expect(cap.entries).toHaveLength(1);
  });

  test("other internal errors stay out of the client message", () => {
    const cap = captureLog();
    const err = new Error('password authentication failed for user "auth"');
    const safe = toClientError(err, cap.log);
    expect(safe.message).toBe(UNEXPECTED_CLIENT_MESSAGE);
    expect(safe.message).not.toContain("password");
    expect(cap.entries).toHaveLength(1);
    expect(cap.entries[0]?.attributes?.error_type).toBe(ErrorType.Internal);
    expect((cap.entries[0]?.error as Error).message).toContain("password authentication failed");
  });

  test("protocol errors pass through", () => {
    const cap = captureLog();
    const oauth = new OauthError("invalid_request", "Missing parameter: client_id");
    expect(toClientError(oauth, cap.log)).toBe(oauth);
    const state = new UnknownStateError();
    expect(toClientError(state, cap.log)).toBe(state);
    expect(cap.entries).toHaveLength(0);
  });

  test("filter drops only suppressed errors", () => {
    const printed: unknown[][] = [];
    const write = (...args: unknown[]) => {
      printed.push(args);
    };
    const err = new Error("visible");
    filterConsoleErrorArgs([err], write);
    suppressRawTrace(err);
    filterConsoleErrorArgs([err], write);
    filterConsoleErrorArgs(["structured log line"], write);
    expect(printed).toEqual([[err], ["structured log line"]]);
  });
});

describe("installClientErrorBoundary", () => {
  test("OpenAuth-style handler sees the generic message, not the config text", () => {
    const cap = captureLog();
    const printed: unknown[][] = [];
    const seen: string[] = [];
    const app = {
      errorHandler(err: Error, _c?: unknown) {
        filterConsoleErrorArgs([err], (...args) => {
          printed.push(args);
        });
        seen.push(err.message);
        return err.message;
      },
      onError(next: (err: Error, c: unknown) => unknown) {
        this.errorHandler = next as typeof this.errorHandler;
      },
    };

    installClientErrorBoundary(app, cap.log);
    const message = app.errorHandler(new ConfigError(SMTP_REQUIRED_MESSAGE), {});

    expect(message).toBe(SIGNUP_UNAVAILABLE_MESSAGE);
    expect(seen).toEqual([SIGNUP_UNAVAILABLE_MESSAGE]);
    expect(printed).toEqual([]);
    expect(cap.entries).toHaveLength(1);
    expect(cap.entries[0]?.attributes?.error_type).toBe("internal");
    expect(String((cap.entries[0]?.error as Error).message)).toContain("SMTP_HOST");
    expect(message).not.toContain("AUTH_DEV_MODE");
  });

  test("UnauthorizedClientError and MissingParameterError return 400 directly instead of redirecting", async () => {
    const cap = captureLog();
    let delegated = false;
    const app = {
      errorHandler(_err: Error, _c?: unknown): unknown {
        delegated = true;
        return new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } });
      },
      onError(next: (err: Error, c: unknown) => unknown) {
        this.errorHandler = next;
      },
    };

    installClientErrorBoundary(app, cap.log);

    const res1 = app.errorHandler(new UnauthorizedClientError("plat5", "https://evil.example/steal"), {}) as Response;
    expect(delegated).toBe(false);
    expect(res1.status).toBe(400);
    expect(await res1.json()).toEqual({
      error: "unauthorized_client",
      error_description: "Client plat5 is not authorized to use this redirect_uri: https://evil.example/steal",
    });

    const res2 = app.errorHandler(new MissingParameterError("client_id"), {}) as Response;
    expect(delegated).toBe(false);
    expect(res2.status).toBe(400);
    expect(await res2.json()).toEqual({
      error: "invalid_request",
      error_description: "Missing parameter: client_id",
    });
  });
});
