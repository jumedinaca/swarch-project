import { NextResponse, type NextRequest } from "next/server";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  sessionCookieOptions,
} from "./lib/cookies";
import { isTokenExpired } from "./lib/jwt";

const GATEWAY_URL = (
  process.env.API_GATEWAY_URL ??
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

function withCookies(
  request: NextRequest,
  cookies: Map<string, string>,
): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(
    "cookie",
    Array.from(cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; "),
  );
  return NextResponse.next({ request: { headers } });
}

/**
 * SSR necesita un access token vigente antes de renderizar la página. Si venció
 * y hay refresh token, se renueva aquí y se reenvía al Server Component.
 */
export async function proxy(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (accessToken && !isTokenExpired(accessToken)) {
    return NextResponse.next();
  }

  if (!refreshToken) {
    const cookies = new Map(
      request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]),
    );
    cookies.delete(ACCESS_COOKIE);
    return withCookies(request, cookies);
  }

  try {
    const response = await fetch(`${GATEWAY_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });

    if (response.ok) {
      const body = (await response.json()) as {
        data?: { token?: string; refreshToken?: string; refresh_token?: string };
      };
      const token = body.data?.token;
      const nextRefresh = body.data?.refreshToken ?? body.data?.refresh_token;

      if (token) {
        const cookies = new Map(
          request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]),
        );
        cookies.set(ACCESS_COOKIE, token);
        if (nextRefresh) cookies.set(REFRESH_COOKIE, nextRefresh);

        const next = withCookies(request, cookies);
        next.cookies.set(ACCESS_COOKIE, token, sessionCookieOptions(ACCESS_MAX_AGE));
        if (nextRefresh) {
          next.cookies.set(
            REFRESH_COOKIE,
            nextRefresh,
            sessionCookieOptions(REFRESH_MAX_AGE),
          );
        }
        return next;
      }
    }
  } catch {
    // Si el gateway no responde, se limpian las cookies y la página pide iniciar sesión.
  }

  const cookies = new Map(
    request.cookies.getAll().map((cookie) => [cookie.name, cookie.value]),
  );
  cookies.delete(ACCESS_COOKIE);
  cookies.delete(REFRESH_COOKIE);
  const next = withCookies(request, cookies);
  next.cookies.delete(ACCESS_COOKIE);
  next.cookies.delete(REFRESH_COOKIE);
  return next;
}

export const config = {
  matcher: ["/account", "/account/:path*"],
};
