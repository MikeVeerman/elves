import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";

export type AuthConfig = { username: string; password: string; secret: string };

const COOKIE = "elves_session";

/** Compares in constant time, so response timing doesn't leak how much of a guess was right. */
export function credentialsMatch(
  given: { username: string; password: string },
  expected: { username: string; password: string },
): boolean {
  const digest = (u: string, p: string) => createHash("sha256").update(`${u}\0${p}`).digest();
  return timingSafeEqual(digest(given.username, given.password), digest(expected.username, expected.password));
}

/**
 * The session cookie is signed (it can't be forged) and SameSite=Lax: the browser leaves it off
 * form posts that another website sends, so another site can't change anything here.
 */
export function startSession(c: Context, auth: AuthConfig): Promise<void> {
  return setSignedCookie(c, COOKIE, auth.username, auth.secret, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Everything behind this needs a session. Pages send you to the login page; anything else gets a 401. */
export function requireLogin(auth: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    // Second line of defence: browsers say where a request comes from. Refuse changes from other sites.
    const site = c.req.header("sec-fetch-site");
    if (c.req.method !== "GET" && site && site !== "same-origin" && site !== "none") {
      return c.text("Requests from other websites are not allowed.", 403);
    }

    const user = await getSignedCookie(c, auth.secret, COOKIE);
    if (!user) {
      const isPage = c.req.method === "GET" && !c.req.path.endsWith("/stream");
      return isPage ? c.redirect("/login") : c.text("Not logged in.", 401);
    }
    await next();
  };
}
