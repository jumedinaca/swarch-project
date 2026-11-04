export const GATEWAY_URL = (
  process.env.API_GATEWAY_URL ??
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ??
  "http://localhost:8080"
).replace(/\/$/, "");

export class GatewayError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

interface GatewayOptions {
  method?: string;
  token?: string | null;
  body?: unknown;
  formData?: FormData;
  timeoutMs?: number;
}

interface GatewayErrorBody {
  error?: string;
  message?: string;
  detail?: unknown;
}

function errorMessage(body: GatewayErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  if (body.message) return body.message;
  if (body.error) return body.error;
  if (typeof body.detail === "string") return body.detail;
  if (Array.isArray(body.detail)) {
    return body.detail
      .map((item) => (typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item)))
      .join(", ");
  }
  return fallback;
}

export async function gatewayJson<T>(path: string, options: GatewayOptions = {}): Promise<T> {
  const {
    method = "GET",
    token,
    body,
    formData,
    // Margen para el primer render tras un arranque en frío de Docker.
    timeoutMs = 15000,
  } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      method,
      headers,
      body: requestBody,
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const errorBody = data && typeof data === "object" ? (data as GatewayErrorBody) : null;
      const fallback =
        typeof data === "string" && data.trim()
          ? data.trim()
          : `El servidor respondió ${response.status}.`;
      throw new GatewayError(
        errorMessage(errorBody, fallback),
        response.status,
        errorBody?.error,
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new GatewayError("La operación tardó demasiado. Inténtalo de nuevo.", 408);
    }
    throw new GatewayError(
      "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export interface AuthEnvelope {
  success?: boolean;
  data?: {
    user?: {
      id: string;
      username: string;
      email?: string;
    };
    token: string;
    refreshToken?: string;
    refresh_token?: string;
  };
  message?: string;
}

export async function loginWithGateway(identifier: string, password: string): Promise<AuthEnvelope> {
  return gatewayJson<AuthEnvelope>("/api/auth/login", {
    method: "POST",
    body: { usernameOrEmail: identifier, password },
  });
}

export function errorToMessage(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado.";
}
