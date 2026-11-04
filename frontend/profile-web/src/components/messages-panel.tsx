"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Clock3,
  MapPin,
  MessageSquareText,
  Radio,
  Send,
  Trash2,
} from "lucide-react";
import { createMessageAction, deleteMessageAction } from "@/app/account/actions";
import { relativeTime } from "@/lib/format";
import { DEFAULT_LOCATION } from "@/lib/theme";
import type { AccountMessage } from "@/lib/types";
import { Avatar } from "./avatar";
import { Button, EmptyState, Notice, PanelHeader } from "./ui";
import type { PanelProps } from "./panel-types";

type Scope = "mine" | "all";

const statusChip = {
  publicado: "chip-green",
  pendiente: "chip-amber",
  oculto: "chip-blue",
  eliminado: "chip-red",
} as const;

const moderationLabels: Record<string, string> = {
  ALLOW: "APROBADA",
  PENDING: "PENDIENTE",
  WARN: "CON ADVERTENCIA",
  BLOCK: "OCULTA",
  REVIEW: "EN REVISIÓN",
  DEGRADED: "REVISIÓN MANUAL",
};

function MessageCard({
  message,
  onDelete,
  deleting,
}: {
  message: AccountMessage;
  onDelete: (message: AccountMessage) => void;
  deleting: boolean;
}) {
  return (
    <article className="message-card">
      <div className="message-head">
        <div className="message-author">
          <Avatar
            name={message.authorName}
            color={message.authorColor}
            size="sm"
          />
          <div>
            <div className="message-author-name">
              <span>{message.authorName}</span>
              {message.isMine ? <span className="chip chip-dark">TÚ</span> : null}
            </div>
            <span className="message-time">
              {relativeTime(message.createdAt).toUpperCase()} ·{" "}
              {new Date(message.createdAt).toLocaleTimeString("es-CO", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "UTC",
              })}
            </span>
          </div>
        </div>
        <span className={`chip ${statusChip[message.status]}`}>
          {message.status.toUpperCase()}
        </span>
      </div>

      <p className="message-content">{message.content}</p>

      <div className="message-footer">
        <div className="message-meta">
          <span className="mono-meta">
            <MapPin size={10} />
            {message.latitude.toFixed(4)}, {message.longitude.toFixed(4)}
          </span>
          <span className="mono-meta">
            <Clock3 size={10} />
            {relativeTime(message.createdAt).toUpperCase()}
          </span>
          {message.moderationStatus ? (
            <span className="mono-meta">
              REVISIÓN:{" "}
              {moderationLabels[message.moderationStatus] ?? message.moderationStatus}
            </span>
          ) : null}
        </div>
        {message.isMine && message.status !== "eliminado" ? (
          <Button
            size="sm"
            variant="ghost"
            loading={deleting}
            onClick={() => onDelete(message)}
            icon={<Trash2 size={12} />}
          >
            ELIMINAR
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function MessagesPanel({ data, mode, onData, notify }: PanelProps) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("mine");
  const [draft, setDraft] = useState("");
  const [latitude, setLatitude] = useState(String(DEFAULT_LOCATION.latitude));
  const [longitude, setLongitude] = useState(String(DEFAULT_LOCATION.longitude));
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      scope === "mine"
        ? data.messages.filter((message) => message.isMine)
        : data.messages,
    [data.messages, scope],
  );

  const mine = data.messages.filter((message) => message.isMine);
  const pending = data.messages.filter((message) => message.status === "pendiente");
  const published = data.messages.filter((message) => message.status === "publicado");

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content) {
      notify("Escribe el contenido de la nota.", "warn");
      return;
    }
    if (content.length > 140) {
      notify("La nota admite máximo 140 caracteres.", "warn");
      return;
    }

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      notify("La latitud y la longitud deben ser números válidos.", "warn");
      return;
    }

    if (mode === "demo") {
      const now = new Date().toISOString();
      const newMessage: AccountMessage = {
        id: `demo-local-${Date.now()}`,
        authorId: data.profile.userId,
        authorName: data.profile.displayName || data.profile.username,
        authorColor: data.profile.color,
        content,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
        createdAt: now,
        status: "pendiente",
        moderationStatus: "PENDING",
        isMine: true,
      };
      onData((previous) => ({
        ...previous,
        messages: [newMessage, ...previous.messages],
      }));
      setDraft("");
      notify("Nota creada en la cuenta de ejemplo (quedaría pendiente de revisión).", "success");
      return;
    }

    startTransition(async () => {
      const result = await createMessageAction({
        content,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
      });
      if (result.ok) {
        setDraft("");
        notify(result.message ?? "Nota enviada.", "success");
        router.refresh();
      } else {
        notify(result.error ?? "No se pudo publicar la nota.", "error");
      }
    });
  };

  const handleDelete = (message: AccountMessage) => {
    if (!window.confirm("¿Eliminar esta nota del radar?")) return;

    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        messages: previous.messages.filter((item) => item.id !== message.id),
      }));
      notify("Nota eliminada en la cuenta de ejemplo.", "success");
      return;
    }

    setDeletingId(message.id);
    startTransition(async () => {
      const result = await deleteMessageAction(message.id);
      setDeletingId(null);
      if (result.ok) {
        notify(result.message ?? "Nota eliminada.", "success");
        router.refresh();
      } else {
        notify(result.error ?? "No se pudo eliminar la nota.", "error");
      }
    });
  };

  return (
    <div className="panel-grid">
      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="RADAR DE NOTAS"
            title="Tus mensajes"
            subtitle="Notas geolocalizadas publicadas cerca de la zona del campus."
            aside={<MessageSquareText size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="filter-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className={`filter-pill ${scope === "mine" ? "active" : ""}`}
                onClick={() => setScope("mine")}
              >
                MÍAS [{mine.length}]
              </button>
              <button
                type="button"
                className={`filter-pill ${scope === "all" ? "active" : ""}`}
                onClick={() => setScope("all")}
              >
                TODAS [{data.messages.length}]
              </button>
              <span className="chip chip-green">{published.length} PUBLICADAS</span>
              <span className="chip chip-amber">{pending.length} PENDIENTES</span>
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<Radio size={34} />}
                title={scope === "mine" ? "[ SIN NOTAS PROPIAS ]" : "[ RADAR VACÍO ]"}
                text={
                  scope === "mine"
                    ? "Aún no tienes notas en este radio. Escribe la primera con el formulario de la derecha."
                    : "No hay notas publicadas dentro del radio de 1500 m."
                }
              />
            ) : (
              <div className="message-list">
                {visible.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    onDelete={handleDelete}
                    deleting={deletingId === message.id}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              <Radio size={11} /> RADIO 1500 M · {DEFAULT_LOCATION.label.toUpperCase()}
            </span>
            <span className="chip">SOLO PUBLICADAS EN EL FEED</span>
          </div>
        </section>
      </div>

      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="NUEVA NOTA"
            title="Publicar en el radar"
            subtitle="Las notas pasan por moderación antes de aparecer en el mapa."
            aside={<Send size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <form className="form-stack" onSubmit={handleCreate}>
              <div className="field">
                <span className="field-label">Contenido</span>
                <textarea
                  className="textarea"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={140}
                  placeholder="Una recomendación, un aviso o una historia para quien pase por aquí…"
                />
                <span className={`counter ${draft.length > 140 ? "over" : ""}`}>
                  {draft.length}/140
                </span>
              </div>

              <div className="field-row">
                <label className="field">
                  <span className="field-label">Latitud</span>
                  <input
                    className="input input-mono"
                    value={latitude}
                    onChange={(event) => setLatitude(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
                <label className="field">
                  <span className="field-label">Longitud</span>
                  <input
                    className="input input-mono"
                    value={longitude}
                    onChange={(event) => setLongitude(event.target.value)}
                    inputMode="decimal"
                  />
                </label>
              </div>

              <div className="compose-location">
                <MapPin size={12} />
                {DEFAULT_LOCATION.label} · {latitude}, {longitude}
              </div>

              <div className="inline-actions">
                <Button
                  type="submit"
                  variant="mint"
                  loading={isPending}
                  icon={<Send size={13} />}
                >
                  PUBLICAR NOTA
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setLatitude(String(DEFAULT_LOCATION.latitude));
                    setLongitude(String(DEFAULT_LOCATION.longitude));
                  }}
                >
                  USAR CAMPUS
                </Button>
              </div>
            </form>
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              <Clock3 size={11} /> REVISIÓN AUTOMÁTICA
            </span>
          </div>
        </section>

        <Notice tone="info">
          Solo se muestran las notas publicadas cerca de ti. Una nota recién creada
          puede tardar unos segundos en aparecer mientras se revisa.
        </Notice>
      </div>
    </div>
  );
}
