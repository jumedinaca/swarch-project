import { cookies } from "next/headers";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
  sessionCookieOptions,
} from "./cookies";
import { decodeJwtPayload, isTokenExpired } from "./jwt";

export interface Session {
  accessToken: string;
  refreshToken?: string;
  userId: string;
  username: string;
}

interface SessionTokens {
  token: string;
  refreshToken?: string;
}

export function sessionFromToken(token: string, refreshToken?: string): Session | null {
  const payload = decodeJwtPayload(token);
  if (!payload?.sub) return null;
  return {
    accessToken: token,
    refreshToken,
    userId: payload.sub,
    username: payload.username ?? "",
  };
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  if (!accessToken || isTokenExpired(accessToken)) return null;
  return sessionFromToken(accessToken, store.get(REFRESH_COOKIE)?.value);
}

/** Solo se puede llamar desde Server Actions o Route Handlers. */
export async function setSessionCookies(tokens: SessionTokens): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.token, sessionCookieOptions(ACCESS_MAX_AGE));
  if (tokens.refreshToken) {
    store.set(REFRESH_COOKIE, tokens.refreshToken, sessionCookieOptions(REFRESH_MAX_AGE));
  }
}

/** Solo se puede llamar desde Server Actions o Route Handlers. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}
