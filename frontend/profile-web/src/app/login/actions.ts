"use server";

import { redirect } from "next/navigation";
import {
  errorToMessage,
  GatewayError,
  loginWithGateway,
} from "@/lib/gateway";
import { setSessionCookies } from "@/lib/session";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _previousState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!identifier || !password) {
    return { error: "Ingresa tu usuario o correo y la contraseña." };
  }

  try {
    const response = await loginWithGateway(identifier, password);
    const data = response.data;
    if (!data?.token) {
      return { error: response.message || "No se pudo iniciar sesión." };
    }

    await setSessionCookies({
      token: data.token,
      refreshToken: data.refreshToken ?? data.refresh_token,
    });
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      return { error: "Usuario o contraseña incorrectos." };
    }
    return { error: errorToMessage(error) };
  }

  redirect("/account");
}
