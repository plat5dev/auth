/**
 * OpenAuth 0.4.3's /token success response has no `token_type`. RFC 6749 §5.1
 * requires it, and strict clients (oauth4webapi, used by the operator console)
 * reject the response without it. The tokens are bearer tokens: add
 * `"token_type": "Bearer"` when OpenAuth left it out.
 *
 * Only a 200 JSON body from POST /token that has an access_token is touched.
 * Errors and every other route pass through unchanged.
 */
export async function withTokenType(
  request: Request,
  response: Response,
): Promise<Response> {
  if (request.method !== "POST" || response.status !== 200) return response;
  if (new URL(request.url).pathname !== "/token") return response;
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    return response;
  }

  const body = (await response.json()) as Record<string, unknown> | null;
  if (
    body === null ||
    typeof body !== "object" ||
    typeof body.access_token !== "string" ||
    "token_type" in body
  ) {
    return Response.json(body, response);
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return Response.json(
    { ...body, token_type: "Bearer" },
    { status: response.status, statusText: response.statusText, headers },
  );
}
