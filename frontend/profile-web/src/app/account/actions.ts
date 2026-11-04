"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorToMessage, gatewayJson, GatewayError } from "@/lib/gateway";
import { clearSessionCookies, getSession } from "@/lib/session";
import type { ActionResult, Profile, ProfileSearchResult } from "@/lib/types";

function failure(error: unknown): ActionResult {
  return { ok: false, error: errorToMessage(error) };
}

async function tokenOrNull(): Promise<string | null> {
  const session = await getSession();
  return session?.accessToken ?? null;
}

async function graphql<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const body = await gatewayJson<{
    data?: T | null;
    errors?: { message: string; extensions?: { code?: string } }[];
  }>("/api/network/graphql", {
    method: "POST",
    token,
    body: { query, variables },
  });

  if (body.errors?.length) {
    throw new GatewayError(
      body.errors[0].message,
      502,
      body.errors[0].extensions?.code,
    );
  }
  if (!body.data) {
    throw new GatewayError("No se pudo completar la operación. Inténtalo de nuevo.", 502);
  }
  return body.data;
}

export async function searchProfilesAction(
  query: string,
  limit = 10,
): Promise<ProfileSearchResult> {
  const token = await tokenOrNull();
  if (!token) {
    return { ok: false, error: "Inicia sesión para buscar exploradores." };
  }

  const clean = query.trim();
  if (clean.length < 2 || clean.length > 50) {
    return { ok: false, error: "Escribe entre 2 y 50 caracteres del nombre de usuario." };
  }

  try {
    const params = new URLSearchParams({
      q: clean,
      limit: String(Math.min(50, Math.max(1, Math.trunc(limit) || 10))),
    });
    const profiles = await gatewayJson<Profile[]>(
      `/api/profiles/search?${params.toString()}`,
      { token },
    );
    return { ok: true, profiles };
  } catch (error) {
    return { ok: false, error: errorToMessage(error) };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Consulta uno o varios perfiles por id (GET /profiles/{id} o /profiles/batch). */
export async function lookupProfilesAction(ids: string[]): Promise<ProfileSearchResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para consultar perfiles." };

  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (unique.length === 0) {
    return { ok: false, error: "Escribe al menos un id de explorador." };
  }
  if (unique.length > 100) {
    return { ok: false, error: "Puedes consultar máximo 100 ids a la vez." };
  }
  const invalid = unique.find((id) => !UUID_PATTERN.test(id));
  if (invalid) {
    return { ok: false, error: `"${invalid}" no es un id válido (UUID).` };
  }

  try {
    if (unique.length === 1) {
      const profile = await gatewayJson<Profile>(
        `/api/profiles/${encodeURIComponent(unique[0])}`,
        { token },
      );
      return { ok: true, profiles: [profile] };
    }
    const params = new URLSearchParams({ ids: unique.join(",") });
    const profiles = await gatewayJson<Profile[]>(`/api/profiles/batch?${params}`, {
      token,
    });
    return { ok: true, profiles };
  } catch (error) {
    return { ok: false, error: errorToMessage(error) };
  }
}

export async function updateProfileAction(input: {
  displayName: string;
  about: string;
  color: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Inicia sesión para editar tu perfil." };

  const displayName = input.displayName.trim();
  const about = input.about.trim();
  const color = input.color.trim().toUpperCase();

  if (displayName.length > 50) {
    return { ok: false, error: "El nombre visible admite máximo 50 caracteres." };
  }
  if (about.length > 500) {
    return { ok: false, error: "La descripción admite máximo 500 caracteres." };
  }
  if (!/^#[0-9A-F]{6}$/.test(color)) {
    return { ok: false, error: "El color debe tener el formato #RRGGBB." };
  }

  try {
    await gatewayJson<Profile>("/api/profiles/me", {
      method: "PATCH",
      token: session.accessToken,
      body: {
        displayName: displayName || null,
        about: about || null,
        color,
      },
    });
    revalidatePath("/account");
    return { ok: true, message: "Perfil actualizado." };
  } catch (error) {
    return failure(error);
  }
}

export async function uploadAvatarAction(formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Inicia sesión para cambiar tu avatar." };

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { ok: false, error: "Selecciona una imagen JPEG, PNG o WebP." };
  }

  try {
    const body = new FormData();
    body.append("file", file);
    await gatewayJson<{ avatarUrl: string }>("/api/profiles/me/avatar", {
      method: "POST",
      token: session.accessToken,
      formData: body,
      timeoutMs: 25_000,
    });
    revalidatePath("/account");
    return { ok: true, message: "Avatar actualizado." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAvatarAction(): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para cambiar tu avatar." };

  try {
    await gatewayJson("/api/profiles/me/avatar", {
      method: "DELETE",
      token,
    });
    revalidatePath("/account");
    return { ok: true, message: "Avatar eliminado." };
  } catch (error) {
    return failure(error);
  }
}

export async function createMessageAction(input: {
  content: string;
  latitude: number;
  longitude: number;
}): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para publicar notas." };

  const content = input.content.trim();
  if (content.length < 1 || content.length > 140) {
    return { ok: false, error: "La nota debe tener entre 1 y 140 caracteres." };
  }
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return { ok: false, error: "La ubicación de la nota no es válida." };
  }

  try {
    await gatewayJson("/api/messages", {
      method: "POST",
      token,
      body: {
        content,
        latitude: input.latitude,
        longitude: input.longitude,
      },
    });
    revalidatePath("/account");
    return {
      ok: true,
      message: "Nota enviada. La moderación puede tardar unos segundos.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteMessageAction(messageId: string): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para eliminar notas." };

  try {
    await gatewayJson(`/api/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
      token,
    });
    revalidatePath("/account");
    return { ok: true, message: "Nota eliminada." };
  } catch (error) {
    return failure(error);
  }
}

export async function sendFriendRequestAction(recipientId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Inicia sesión para agregar amigos." };

  const cleanId = recipientId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanId)) {
    return { ok: false, error: "Selecciona un explorador válido." };
  }
  if (cleanId.toLowerCase() === session.userId.toLowerCase()) {
    return { ok: false, error: "No puedes enviarte una solicitud a ti mismo." };
  }

  try {
    await graphql(
      session.accessToken,
      `mutation SendFriendRequest($recipientId: UUID!) {
        sendFriendRequest(recipientId: $recipientId) { id }
      }`,
      { recipientId: cleanId },
    );
    revalidatePath("/account");
    return { ok: true, message: "Solicitud de amistad enviada." };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptFriendRequestAction(requestId: string): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para gestionar tu red." };

  try {
    await graphql(
      token,
      `mutation AcceptFriendRequest($id: ID!) {
        acceptFriendRequest(id: $id) { id }
      }`,
      { id: requestId },
    );
    revalidatePath("/account");
    return { ok: true, message: "Solicitud aceptada." };
  } catch (error) {
    return failure(error);
  }
}

export async function rejectFriendRequestAction(requestId: string): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para gestionar tu red." };

  try {
    await graphql(
      token,
      `mutation RejectFriendRequest($id: ID!) { rejectFriendRequest(id: $id) }`,
      { id: requestId },
    );
    revalidatePath("/account");
    return { ok: true, message: "Solicitud rechazada." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelFriendRequestAction(requestId: string): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para gestionar tu red." };

  try {
    await graphql(
      token,
      `mutation CancelFriendRequest($id: ID!) { cancelFriendRequest(id: $id) }`,
      { id: requestId },
    );
    revalidatePath("/account");
    return { ok: true, message: "Solicitud cancelada." };
  } catch (error) {
    return failure(error);
  }
}

export async function removeFriendAction(friendId: string): Promise<ActionResult> {
  const token = await tokenOrNull();
  if (!token) return { ok: false, error: "Inicia sesión para gestionar tu red." };

  try {
    await graphql(
      token,
      `mutation RemoveFriend($friendId: UUID!) { removeFriend(friendId: $friendId) }`,
      { friendId },
    );
    revalidatePath("/account");
    return { ok: true, message: "Amigo eliminado." };
  } catch (error) {
    return failure(error);
  }
}

export async function recomputeReputationAction(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Inicia sesión para recalcular tu reputación." };

  try {
    await gatewayJson(`/api/reputation/${session.userId}/recompute`, {
      method: "POST",
      token: session.accessToken,
    });
    revalidatePath("/account");
    return { ok: true, message: "Reputación recalculada." };
  } catch (error) {
    return failure(error);
  }
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    try {
      await gatewayJson("/api/auth/logout", {
        method: "POST",
        token: session.accessToken,
      });
    } catch {
      // Aunque el gateway falle, la sesión local se elimina.
    }
  }
  await clearSessionCookies();
  redirect("/login");
}
