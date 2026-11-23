export const ACCESS_COOKIE = "gp_profile_access";
export const REFRESH_COOKIE = "gp_profile_refresh";

export const ACCESS_MAX_AGE = 15 * 60;
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

// Secure por defecto en produccion: el panel solo se publica por HTTPS a traves
// del reverse proxy, y una cookie Secure nunca viaja por http:// (no se puede
// interceptar en un salto sin cifrar). COOKIE_SECURE=false permite probarlo por
// http fuera del proxy; en `npm run dev` queda desactivado salvo que se pida.
function cookieSecure(): boolean {
  const flag = process.env.COOKIE_SECURE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    maxAge,
  };
}
