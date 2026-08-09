import { SignJWT } from "jose";
import { signingKeys } from "@openauthjs/openauth/keys";
import type { StorageAdapter } from "@openauthjs/openauth/storage/storage";
import type { UsersStore } from "../db/users.ts";

const ACCESS_TTL_SECS = 60 * 60;

export type DevTokenDeps = {
  storage: StorageAdapter;
  users: UsersStore;
  allowedClients: string[];
  /** Identity provider label stored on the user row (matches password flow). */
  provider?: string;
};

async function resolveSubject(
  type: string,
  properties: Record<string, unknown>,
): Promise<string> {
  const jsonString = JSON.stringify(properties);
  const data = new TextEncoder().encode(jsonString);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${type}:${hashHex.slice(0, 16)}`;
}

function issuerFromRequest(request: Request): string {
  const publicUrl = process.env.PUBLIC_ISSUER_URL?.replace(/\/$/, "");
  if (publicUrl) return publicUrl;
  return new URL(request.url).origin;
}

function json(
  status: number,
  body: unknown,
  requestId: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
}

/**
 * Dev-only: mint an access token for an email without the OIDC UI flow.
 * getOrCreateUser so fixture emails stay stable across runs.
 */
export async function handleDevToken(
  request: Request,
  requestId: string,
  deps: DevTokenDeps,
): Promise<Response> {
  if (request.method !== "POST") {
    return json(
      405,
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "POST only",
          request_id: requestId,
        },
      },
      requestId,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(
      400,
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid JSON body",
          request_id: requestId,
        },
      },
      requestId,
    );
  }

  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof (body as { email: unknown }).email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  const clientIdRaw =
    typeof body === "object" &&
    body !== null &&
    "client_id" in body &&
    typeof (body as { client_id: unknown }).client_id === "string"
      ? (body as { client_id: string }).client_id.trim()
      : "plat5";

  if (!email || !email.includes("@")) {
    return json(
      422,
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "email is required",
          request_id: requestId,
        },
      },
      requestId,
    );
  }

  if (!deps.allowedClients.includes(clientIdRaw)) {
    return json(
      422,
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `client_id not allowed: ${clientIdRaw}`,
          request_id: requestId,
        },
      },
      requestId,
    );
  }

  const provider = deps.provider ?? "password";
  const userId = await deps.users.getOrCreateUser(provider, email);
  const properties = { user_id: userId };
  const subject = await resolveSubject("user", properties);
  const keys = await signingKeys(deps.storage);
  const key = keys.find((k) => !k.expired) ?? keys[0];
  if (!key) {
    return json(
      500,
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "No signing key available",
          request_id: requestId,
        },
      },
      requestId,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({
    mode: "access",
    type: "user",
    properties,
    aud: clientIdRaw,
    iss: issuerFromRequest(request),
    sub: subject,
  })
    .setExpirationTime(now + ACCESS_TTL_SECS)
    .setProtectedHeader({
      alg: key.alg,
      kid: key.id,
      typ: "JWT",
    })
    .sign(key.private);

  return json(
    200,
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECS,
      user_id: userId,
    },
    requestId,
  );
}
