import { describe, expect, test } from "bun:test";
import { normalizeRoute } from "./http-metrics.ts";

describe("normalizeRoute", () => {
  test("keeps served OIDC and static paths", () => {
    expect(normalizeRoute("/authorize")).toBe("/authorize");
    expect(normalizeRoute("/token")).toBe("/token");
    expect(normalizeRoute("/dev/token")).toBe("/dev/token");
    expect(normalizeRoute("/static/logo.jpg")).toBe("/static/logo.jpg");
    expect(normalizeRoute("/static/p5.jpg")).toBe("/static/p5.jpg");
    expect(normalizeRoute("/.well-known/jwks.json")).toBe("/.well-known/jwks.json");
    expect(normalizeRoute("/.well-known/oauth-authorization-server")).toBe(
      "/.well-known/oauth-authorization-server",
    );
  });

  test("templates provider UI paths", () => {
    expect(normalizeRoute("/password/authorize")).toBe("/{provider}/authorize");
    expect(normalizeRoute("/password/register")).toBe("/{provider}/register");
    expect(normalizeRoute("/password/change")).toBe("/{provider}/change");
    expect(normalizeRoute("/password/callback")).toBe("/{provider}/callback");
  });

  test("collapses unknown paths including scanners and other well-known suffixes", () => {
    expect(normalizeRoute("/.aws_credentials")).toBe("unmatched");
    expect(normalizeRoute("/.well-known/openid-configuration")).toBe("unmatched");
    expect(normalizeRoute("/@fs/proc/self/environ")).toBe("unmatched");
    expect(normalizeRoute("/password/authorize/extra")).toBe("unmatched");
    expect(normalizeRoute("/")).toBe("unmatched");
  });
});
