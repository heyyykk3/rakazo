import type { Auth } from "@rakazo/auth";
import { isBlockedAuthPath } from "@rakazo/auth";
import type { Context, Hono } from "hono";
import { withClientIp } from "../http/client-ip.js";
import { emptyAuthBodyAsJson, withAuthLibraryFailures } from "./auth-library-failures.js";
import { createAuthResponseAudit } from "./security-audit.js";

/** Mounts Better Auth HTTP routes with blocked-path enforcement and response auditing. */
export function mountAuthHttpRoute(
  app: Hono,
  auth: Auth,
  requestClientIp: (c: Context) => string | undefined,
) {
  const auditAuthResponse = createAuthResponseAudit();
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname.replace("/api/auth", "");
    if (isBlockedAuthPath(path)) {
      return c.json({ error: "Not available in version 1" }, 404);
    }
    const ip = requestClientIp(c);
    const response = await withAuthLibraryFailures(() =>
      auth.handler(withClientIp(emptyAuthBodyAsJson(c.req.raw), ip)),
    );
    await auditAuthResponse(path, ip, response);
    return response;
  });
}
