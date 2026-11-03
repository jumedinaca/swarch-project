"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  AtSign,
  Check,
  Clock3,
  Copy,
  Inbox,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  acceptFriendRequestAction,
  cancelFriendRequestAction,
  rejectFriendRequestAction,
  removeFriendAction,
  searchProfilesAction,
  sendFriendRequestAction,
} from "@/app/account/actions";
import { demoProfiles } from "@/lib/demo-data";
import { formatDate } from "@/lib/format";
import type { Friendship, NetworkMember, Profile } from "@/lib/types";
import { Avatar } from "./avatar";
import { Button, EmptyState, Notice, PanelHeader } from "./ui";
import type { PanelProps } from "./panel-types";

type NetworkTab = "friends" | "incoming" | "outgoing" | "add";

function profileName(profile?: Profile | null): string {
  return profile?.displayName || profile?.username || "Explorador";
}

function profileHandle(profile?: Profile | null): string {
  return profile?.username ? `@${profile.username}` : "";
}

function memberName(member: NetworkMember): string {
  return profileName(member.profile);
}

function memberHandle(member: NetworkMember): string {
  return profileHandle(member.profile);
}

function FriendRow({
  member,
  kind,
  pending,
  onAccept,
  onReject,
  onCancel,
  onRemove,
}: {
  member: NetworkMember;
  kind: "friend" | "incoming" | "outgoing";
  pending: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
}) {
  const name = memberName(member);
  return (
    <div className="friend-row">
      <Avatar
        name={name}
        color={member.profile?.color}
        avatarUrl={member.profile?.avatarUrl}
        size="md"
      />
      <div className="friend-info">
        <div className="friend-name">{name}</div>
        {memberHandle(member) ? (
          <span className="friend-handle">{memberHandle(member)}</span>
        ) : null}
        <div className="friend-meta">
          <span className="chip">
            <Clock3 size={9} />
            {formatDate(
              kind === "incoming"
                ? member.friendship.created_at
                : member.friendship.updated_at,
            ).toUpperCase()}
          </span>
          {kind === "friend" ? (
            <span className="chip chip-green">AMIGO</span>
          ) : kind === "incoming" ? (
            <span className="chip chip-amber">RECIBIDA</span>
          ) : (
            <span className="chip chip-blue">ENVIADA</span>
          )}
        </div>
      </div>
      <div className="friend-actions">
        {kind === "friend" ? (
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={onRemove}
            icon={<Trash2 size={12} />}
            title="Eliminar amigo"
          >
            QUITAR
          </Button>
        ) : null}
        {kind === "incoming" ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              loading={pending}
              onClick={onReject}
              icon={<X size={12} />}
            >
              RECHAZAR
            </Button>
            <Button
              size="sm"
              variant="mint"
              loading={pending}
              onClick={onAccept}
              icon={<Check size={12} />}
            >
              ACEPTAR
            </Button>
          </>
        ) : null}
        {kind === "outgoing" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={onCancel}
            icon={<X size={12} />}
          >
            CANCELAR
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SearchResultRow({
  profile,
  relationship,
  pending,
  onAdd,
}: {
  profile: Profile;
  relationship: string | null;
  pending: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="friend-row">
      <Avatar
        name={profileName(profile)}
        color={profile.color}
        avatarUrl={profile.avatarUrl}
        size="md"
      />
      <div className="friend-info">
        <div className="friend-name">{profileName(profile)}</div>
        <span className="friend-handle">{profileHandle(profile)}</span>
      </div>
      <div className="friend-actions">
        <Button
          size="sm"
          variant={relationship ? "secondary" : "mint"}
          loading={pending}
          disabled={Boolean(relationship)}
          onClick={onAdd}
          icon={<UserPlus size={12} />}
        >
          {relationship ?? "AGREGAR"}
        </Button>
      </div>
    </div>
  );
}

export function NetworkPanel({ data, mode, onData, notify }: PanelProps) {
  const router = useRouter();
  const [tab, setTab] = useState<NetworkTab>("friends");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { network } = data;
  const total = network.friends.length + network.incoming.length;

  const relationshipFor = (profile: Profile): string | null => {
    if (network.friends.some((member) => member.userId === profile.userId)) {
      return "AMIGO";
    }
    if (network.incoming.some((member) => member.userId === profile.userId)) {
      return "SOLICITUD RECIBIDA";
    }
    if (network.outgoing.some((member) => member.userId === profile.userId)) {
      return "SOLICITUD ENVIADA";
    }
    return null;
  };

  const runLive = (
    key: string,
    action: () => Promise<{ ok: boolean; error?: string; message?: string }>,
    fallback: string,
  ) => {
    setActiveAction(key);
    startTransition(async () => {
      const result = await action();
      setActiveAction(null);
      if (result.ok) {
        notify(result.message ?? fallback, "success");
        router.refresh();
      } else {
        notify(result.error ?? fallback, "error");
      }
    });
  };

  const accept = (member: NetworkMember) => {
    if (mode === "demo") {
      onData((previous) => {
        const accepted: NetworkMember = {
          ...member,
          friendship: {
            ...member.friendship,
            status: "accepted",
            updated_at: new Date().toISOString(),
          },
        };
        return {
          ...previous,
          network: {
            ...previous.network,
            incoming: previous.network.incoming.filter(
              (item) => item.friendship.id !== member.friendship.id,
            ),
            friends: [accepted, ...previous.network.friends],
          },
        };
      });
      notify(`Ahora eres amigo de ${memberName(member)}.`, "success");
      return;
    }
    runLive(
      `accept-${member.friendship.id}`,
      () => acceptFriendRequestAction(member.friendship.id),
      "Solicitud aceptada.",
    );
  };

  const reject = (member: NetworkMember) => {
    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        network: {
          ...previous.network,
          incoming: previous.network.incoming.filter(
            (item) => item.friendship.id !== member.friendship.id,
          ),
        },
      }));
      notify("Solicitud rechazada en la cuenta de ejemplo.", "success");
      return;
    }
    runLive(
      `reject-${member.friendship.id}`,
      () => rejectFriendRequestAction(member.friendship.id),
      "Solicitud rechazada.",
    );
  };

  const cancel = (member: NetworkMember) => {
    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        network: {
          ...previous.network,
          outgoing: previous.network.outgoing.filter(
            (item) => item.friendship.id !== member.friendship.id,
          ),
        },
      }));
      notify("Solicitud cancelada en la cuenta de ejemplo.", "success");
      return;
    }
    runLive(
      `cancel-${member.friendship.id}`,
      () => cancelFriendRequestAction(member.friendship.id),
      "Solicitud cancelada.",
    );
  };

  const remove = (member: NetworkMember) => {
    if (!window.confirm(`¿Eliminar a ${memberName(member)} de tus amigos?`)) return;

    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        network: {
          ...previous.network,
          friends: previous.network.friends.filter(
            (item) => item.friendship.id !== member.friendship.id,
          ),
        },
      }));
      notify("Amigo eliminado en la cuenta de ejemplo.", "success");
      return;
    }
    runLive(
      `remove-${member.friendship.id}`,
      () => removeFriendAction(member.userId),
      "Amigo eliminado.",
    );
  };

  const search = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      notify("Escribe al menos 2 caracteres del nombre de usuario.", "warn");
      return;
    }

    setSearchPending(true);
    setHasSearched(true);
    try {
      if (mode === "demo") {
        const needle = query.toLowerCase();
        const matches = Object.values(demoProfiles())
          .filter(
            (profile) =>
              profile.userId !== data.profile.userId &&
              (profile.username.toLowerCase().includes(needle) ||
                (profile.displayName ?? "").toLowerCase().includes(needle)),
          )
          .slice(0, 10);
        setSearchResults(matches);
        return;
      }

      const result = await searchProfilesAction(query);
      if (!result.ok) {
        setSearchResults([]);
        setHasSearched(false);
        notify(result.error ?? "No se pudo buscar exploradores.", "error");
        return;
      }
      setSearchResults(
        (result.profiles ?? []).filter(
          (profile) => profile.userId !== data.profile.userId,
        ),
      );
    } finally {
      setSearchPending(false);
    }
  };

  const sendRequest = (profile: Profile) => {
    const relationship = relationshipFor(profile);
    if (relationship) {
      notify(`Este explorador ya tiene una relación: ${relationship.toLowerCase()}.`, "warn");
      return;
    }

    if (mode === "demo") {
      const now = new Date().toISOString();
      const friendship: Friendship = {
        id: `demo-request-${Date.now()}`,
        user_a: data.profile.userId,
        user_b: profile.userId,
        status: "pending",
        requested_by: data.profile.userId,
        created_at: now,
        updated_at: now,
        other_user_id: profile.userId,
        sent_by_me: true,
      };
      onData((previous) => ({
        ...previous,
        network: {
          ...previous.network,
          outgoing: [
            { friendship, userId: profile.userId, profile },
            ...previous.network.outgoing,
          ],
        },
      }));
      notify(`Solicitud enviada a ${profileHandle(profile)}.`, "success");
      return;
    }

    runLive(
      `send-${profile.userId}`,
      () => sendFriendRequestAction(profile.userId),
      `Solicitud enviada a ${profileHandle(profile)}.`,
    );
  };

  const copyOwnUsername = async () => {
    try {
      await navigator.clipboard.writeText(`@${data.profile.username}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
      notify("Usuario copiado al portapapeles.", "success");
    } catch {
      notify("No se pudo copiar el usuario. Selecciónalo manualmente.", "warn");
    }
  };

  const currentList =
    tab === "friends"
      ? network.friends
      : tab === "incoming"
        ? network.incoming
        : tab === "outgoing"
          ? network.outgoing
          : [];

  return (
    <div className="panel-grid">
      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="TU RED"
            title="Red de exploradores"
            subtitle="Administra amistades y solicitudes desde un solo lugar."
            aside={<Users size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="sub-tabs">
              <button
                type="button"
                className={`sub-tab ${tab === "friends" ? "active" : ""}`}
                onClick={() => setTab("friends")}
              >
                AMIGOS [{network.friends.length}]
              </button>
              <button
                type="button"
                className={`sub-tab ${tab === "incoming" ? "active" : ""}`}
                onClick={() => setTab("incoming")}
              >
                RECIBIDAS [{network.incoming.length}]
              </button>
              <button
                type="button"
                className={`sub-tab ${tab === "outgoing" ? "active" : ""}`}
                onClick={() => setTab("outgoing")}
              >
                ENVIADAS [{network.outgoing.length}]
              </button>
              <button
                type="button"
                className={`sub-tab ${tab === "add" ? "active" : ""}`}
                onClick={() => setTab("add")}
              >
                + AGREGAR
              </button>
            </div>

            {tab === "add" ? (
              <div className="add-friend-form">
                <Notice tone="info">
                  Busca a la otra persona por su <strong>nombre de usuario</strong> y
                  envíale una solicitud desde aquí.
                </Notice>
                <form className="form-stack" onSubmit={search}>
                  <label className="field">
                    <span className="field-label">Nombre de usuario</span>
                    <input
                      className="input"
                      value={searchQuery}
                      onChange={(event) => {
                        setSearchQuery(event.target.value);
                        setHasSearched(false);
                      }}
                      placeholder="ExploradorGeo"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="mint"
                    loading={searchPending}
                    icon={<Search size={14} />}
                  >
                    BUSCAR EXPLORADOR
                  </Button>
                </form>

                {searchResults.length > 0 ? (
                  <div className="network-list" style={{ marginTop: 10 }}>
                    {searchResults.map((profile) => (
                      <SearchResultRow
                        key={profile.userId}
                        profile={profile}
                        relationship={relationshipFor(profile)}
                        pending={activeAction === `send-${profile.userId}`}
                        onAdd={() => sendRequest(profile)}
                      />
                    ))}
                  </div>
                ) : hasSearched && !searchPending ? (
                  <EmptyState
                    icon={<Search size={30} />}
                    title="[ SIN RESULTADOS ]"
                    text="No encontramos exploradores con ese nombre de usuario."
                  />
                ) : null}
              </div>
            ) : currentList.length === 0 ? (
              <EmptyState
                icon={tab === "incoming" ? <Inbox size={34} /> : <Users size={34} />}
                title={
                  tab === "friends"
                    ? "[ LISTA VACÍA ]"
                    : tab === "incoming"
                      ? "[ BANDEJA VACÍA ]"
                      : "[ SIN ENVÍOS ACTIVOS ]"
                }
                text={
                  tab === "friends"
                    ? "Todavía no tienes amigos agregados. Usa + AGREGAR para conectar con otro explorador."
                    : tab === "incoming"
                      ? "No hay solicitudes entrantes pendientes de aprobación."
                      : "Aquí verás las solicitudes que hayas enviado a otros exploradores."
                }
              />
            ) : (
              <div className="network-list">
                {currentList.map((member) => (
                  <FriendRow
                    key={member.friendship.id}
                    member={member}
                    kind={
                      tab === "friends"
                        ? "friend"
                        : tab === "incoming"
                          ? "incoming"
                          : "outgoing"
                    }
                    pending={
                      activeAction?.endsWith(member.friendship.id) ?? false
                    }
                    onAccept={() => accept(member)}
                    onReject={() => reject(member)}
                    onCancel={() => cancel(member)}
                    onRemove={() => remove(member)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              <UserCheck size={11} /> {network.friends.length} AMIGOS
            </span>
            <span className="mono-meta">
              <Clock3 size={11} /> {network.incoming.length} PENDIENTES
            </span>
          </div>
        </section>

      </div>

      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="TU USUARIO"
            title="Tu nombre de usuario"
            subtitle="Compártelo para que puedan encontrarte."
            aside={<AtSign size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="id-card">
              <span className="field-label">Usuario</span>
              <span className="id-value">@{data.profile.username}</span>
              <div className="inline-actions" style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  variant={copied ? "mint" : "secondary"}
                  onClick={copyOwnUsername}
                  icon={copied ? <Check size={12} /> : <Copy size={12} />}
                >
                  {copied ? "COPIADO" : "COPIAR USUARIO"}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            kicker="CONECTAR"
            title="Agregar explorador"
            subtitle="Encuentra a otras personas por su nombre de usuario."
            aside={<UserPlus size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <p className="panel-subtitle" style={{ marginBottom: 10 }}>
              Busca un explorador y envíale una solicitud de amistad. Tú también
              puedes compartir tu usuario para que te encuentren.
            </p>
            <Button
              variant="mint"
              block
              onClick={() => setTab("add")}
              icon={<Search size={13} />}
            >
              BUSCAR EXPLORADOR
            </Button>
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              {total} RELACIONES EN TOTAL
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
