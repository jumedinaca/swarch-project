export interface JwtPayload {
  sub?: string;
  username?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * Decodifica el payload de un JWT sin validar la firma. La validación real la
 * hacen el API Gateway y cada microservicio. Aquí solo se usa para mostrar el
 * usuario y saber cuándo conviene refrescar la sesión.
 */
export function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | undefined | null, skewSeconds = 20): boolean {
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}
