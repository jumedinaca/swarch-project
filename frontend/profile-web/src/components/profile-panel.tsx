"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Fingerprint,
  ImagePlus,
  LogIn,
  LogOut,
  Palette,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  deleteAvatarAction,
  logoutAction,
  updateProfileAction,
  uploadAvatarAction,
} from "@/app/account/actions";
import { formatDate, formatDateTime } from "@/lib/format";
import { avatarPalette } from "@/lib/theme";
import { Avatar } from "./avatar";
import { Button, Notice, PanelHeader } from "./ui";
import type { PanelProps } from "./panel-types";

export function ProfilePanel({ data, mode, onData, notify }: PanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(data.profile.displayName ?? "");
  const [about, setAbout] = useState(data.profile.about ?? "");
  const [color, setColor] = useState(data.profile.color);
  const [isPending, startTransition] = useTransition();
  const [avatarPending, startAvatarTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(data.profile.displayName ?? "");
    setAbout(data.profile.about ?? "");
    setColor(data.profile.color);
  }, [data.profile.displayName, data.profile.about, data.profile.color]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        profile: {
          ...previous.profile,
          displayName: displayName.trim() || previous.profile.username,
          about: about.trim() || null,
          color,
          updatedAt: new Date().toISOString(),
        },
      }));
      notify("Perfil actualizado en la cuenta de ejemplo.", "success");
      return;
    }

    startTransition(async () => {
      const result = await updateProfileAction({ displayName, about, color });
      if (result.ok) {
        notify(result.message ?? "Perfil actualizado.", "success");
        router.refresh();
      } else {
        setFormError(result.error ?? "No se pudo actualizar el perfil.");
        notify(result.error ?? "No se pudo actualizar el perfil.", "error");
      }
    });
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        profile: { ...previous.profile, avatarUrl: URL.createObjectURL(file) },
      }));
      notify("Avatar actualizado en la cuenta de ejemplo.", "success");
      return;
    }

    startAvatarTransition(async () => {
      const body = new FormData();
      body.append("file", file);
      const result = await uploadAvatarAction(body);
      if (result.ok) {
        notify(result.message ?? "Avatar actualizado.", "success");
        router.refresh();
      } else {
        notify(result.error ?? "No se pudo subir el avatar.", "error");
      }
    });
  };

  const handleDeleteAvatar = () => {
    if (mode === "demo") {
      onData((previous) => ({
        ...previous,
        profile: { ...previous.profile, avatarUrl: null },
      }));
      notify("Avatar eliminado en la cuenta de ejemplo.", "success");
      return;
    }

    if (!window.confirm("¿Eliminar tu avatar actual?")) return;

    startAvatarTransition(async () => {
      const result = await deleteAvatarAction();
      if (result.ok) {
        notify(result.message ?? "Avatar eliminado.", "success");
        router.refresh();
      } else {
        notify(result.error ?? "No se pudo eliminar el avatar.", "error");
      }
    });
  };

  return (
    <div className="panel-grid">
      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="IDENTIDAD PÚBLICA"
            title="Datos del perfil"
            subtitle="Así te ven los demás exploradores en el mapa y en la red."
            aside={<UserRound size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <form className="form-stack" onSubmit={handleSubmit}>
              <div className="field">
                <span className="field-label">Nombre visible</span>
                <input
                  className="input"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={50}
                  placeholder={data.profile.username}
                />
                <span className="counter">{displayName.length}/50</span>
                <span className="field-hint">
                  Si lo dejas vacío, se mostrará @{data.profile.username}.
                </span>
              </div>

              <div className="field">
                <span className="field-label">Descripción</span>
                <textarea
                  className="textarea"
                  value={about}
                  onChange={(event) => setAbout(event.target.value)}
                  maxLength={500}
                  placeholder="Cuenta qué exploras, qué te gusta o qué notas dejas en el mapa…"
                />
                <span className="counter">{about.length}/500</span>
              </div>

              <div className="field">
                <span className="field-label">Color de autor</span>
                <div className="color-grid">
                  {avatarPalette.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      className={`color-swatch ${color.toUpperCase() === swatch ? "selected" : ""}`}
                      style={{ background: swatch }}
                      onClick={() => setColor(swatch)}
                      aria-label={`Elegir color ${swatch}`}
                      title={swatch}
                    />
                  ))}
                  <input
                    className="color-custom"
                    type="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value.toUpperCase())}
                    aria-label="Elegir un color personalizado"
                    title="Color personalizado"
                  />
                </div>
                <span className="field-hint">
                  El color se usa en tus notas, tarjetas de amigo y ranking.
                </span>
              </div>

              {formError ? <Notice tone="error">{formError}</Notice> : null}

              <div className="inline-actions">
                <Button
                  type="submit"
                  variant="primary"
                  loading={isPending}
                  icon={<Save size={14} />}
                >
                  GUARDAR CAMBIOS
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<Palette size={14} />}
                  onClick={() => setColor(data.profile.color)}
                >
                  RESTAURAR COLOR
                </Button>
              </div>
            </form>
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              <ShieldCheck size={11} /> ACTUALIZADO {formatDateTime(data.profile.updatedAt)}
            </span>
            <span className="chip">{mode === "live" ? "GUARDADO" : "VISTA DE EJEMPLO"}</span>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            kicker="TU CUENTA"
            title="Datos de la cuenta"
            subtitle="Tu identidad pública dentro de GeoPicto."
            aside={<Fingerprint size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="form-stack">
              <div className="field-row">
                <div className="field">
                  <span className="field-label">Username</span>
                  <span className="input input-mono">@{data.profile.username}</span>
                </div>
                <div className="field">
                  <span className="field-label">Miembro desde</span>
                  <span className="input input-mono">{formatDate(data.profile.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="AVATAR"
            title="Foto de perfil"
            subtitle="JPEG, PNG o WebP · máximo 5 MB."
            aside={<ImagePlus size={17} color="#848E96" />}
          />
          <div className="panel-body" style={{ display: "grid", placeItems: "center", gap: 12 }}>
            <Avatar
              name={data.profile.displayName || data.profile.username}
              color={color}
              avatarUrl={data.profile.avatarUrl}
              size="xl"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
              hidden
            />
            <div className="inline-actions" style={{ justifyContent: "center" }}>
              <Button
                type="button"
                variant="mint"
                size="sm"
                loading={avatarPending}
                onClick={() => fileInputRef.current?.click()}
                icon={<ImagePlus size={13} />}
              >
                SUBIR AVATAR
              </Button>
              {data.profile.avatarUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteAvatar}
                  icon={<Trash2 size={13} />}
                >
                  QUITAR
                </Button>
              ) : null}
            </div>
            <span className="field-hint" style={{ textAlign: "center" }}>
              La imagen se ajusta a 512 × 512 para que se vea bien en toda la app.
            </span>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            kicker="SESIÓN"
            title="Seguridad"
            subtitle="Tu cuenta y tu sesión están protegidas."
            aside={<ShieldCheck size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="notice notice-success" style={{ marginBottom: 12 }}>
              <ShieldCheck size={14} style={{ flex: "none", marginTop: 1 }} />
              <div>
                Puedes cerrar tu sesión en este dispositivo cuando quieras. Tus datos
                seguirán guardados en tu cuenta.
              </div>
            </div>
            {mode === "live" ? (
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  block
                  icon={<LogOut size={13} />}
                >
                  CERRAR SESIÓN
                </Button>
              </form>
            ) : (
              <Link href="/login" className="btn btn-primary btn-block">
                <LogIn size={14} />
                INICIAR SESIÓN
              </Link>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
