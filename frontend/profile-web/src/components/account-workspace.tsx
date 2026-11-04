"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  LogIn,
  LogOut,
  MessageSquareText,
  RefreshCw,
  Search,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { logoutAction } from "@/app/account/actions";
import { formatDate, relativeTime } from "@/lib/format";
import { PROFILE_TABS, type ProfileTab } from "@/lib/theme";
import type { AccountData, AccountMode } from "@/lib/types";
import { Brand } from "./brand";
import { ExplorePanel } from "./explore-panel";
import { NetworkPanel } from "./network-panel";
import { MessagesPanel } from "./messages-panel";
import { ProfilePanel } from "./profile-panel";
import { ReputationPanel } from "./reputation-panel";
import { Avatar } from "./avatar";
import { Button, Notice } from "./ui";
import type { ToastTone } from "./panel-types";

interface AccountWorkspaceProps {
  initialData: AccountData;
  mode: AccountMode;
  notice?: string;
}

interface ToastState {
  message: string;
  tone: ToastTone;
}

const tabIcons = {
  profile: UserRound,
  explore: Search,
  messages: MessageSquareText,
  reputation: Trophy,
  network: Users,
} as const;

export function AccountWorkspace({
  initialData,
  mode,
  notice,
}: AccountWorkspaceProps) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [activeTab, setActiveTab] = useState<ProfileTab>("profile");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timeout);
  }, [toast]);

  const notify = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
  }, []);

  const handleRefresh = () => {
    if (mode === "demo") {
      notify("Esta cuenta de ejemplo ya tiene todos los datos disponibles.", "info");
      return;
    }
    startRefresh(() => router.refresh());
  };

  const profile = data.profile;
  const displayName = profile.displayName || profile.username;
  const ownMessages = data.messages.filter((message) => message.isMine).length;
  const pendingRequests = data.network.incoming.length;
  const lastActivity =
    data.history[0]?.createdAt || data.reputation.updatedAt || data.loadedAt;

  const tabCount = (id: ProfileTab): number | null => {
    if (id === "messages") return data.messages.length;
    if (id === "network") return data.network.friends.length;
    if (id === "reputation") return data.history.length;
    return null;
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          <div className="topbar-actions">
            <span className="session-pill">
              <span className={`session-dot ${mode === "demo" ? "demo" : ""}`} />
              {mode === "demo"
                ? "CUENTA DE EJEMPLO"
                : `@${profile.username} · EN LÍNEA`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRefresh}
              loading={isRefreshing}
              icon={<RefreshCw size={13} />}
              className="hide-mobile"
            >
              ACTUALIZAR
            </Button>
            {mode === "live" ? (
              <form action={logoutAction}>
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  icon={<LogOut size={13} />}
                >
                  SALIR
                </Button>
              </form>
            ) : (
              <Link href="/login" className="btn btn-primary btn-sm">
                <LogIn size={13} />
                ENTRAR
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="account-layout">
        {notice ? <Notice tone="warn">{notice}</Notice> : null}

        {mode === "demo" ? (
          <Notice tone="info">
            <strong>Estás viendo una cuenta de ejemplo.</strong> Puedes recorrer todas
            las secciones y probar los formularios; para guardar tus cambios,{" "}
            <Link href="/login" style={{ textDecoration: "underline", fontWeight: 700 }}>
              inicia sesión
            </Link>
            .
          </Notice>
        ) : null}

        <section className="profile-hero">
          <Avatar
            name={displayName}
            color={profile.color}
            avatarUrl={profile.avatarUrl}
            size="xl"
          />
          <div className="profile-hero-main">
            <div className="profile-name-row">
              <h1 className="profile-name">{displayName}</h1>
              <span className={`chip ${mode === "live" ? "chip-green" : "chip-amber"}`}>
                {mode === "live" ? "EN LÍNEA" : "EJEMPLO"}
              </span>
              <span className="chip chip-dark">{data.reputation.level}</span>
            </div>
            <p className="profile-handle">@{profile.username}</p>
            <p className="profile-about">
              {profile.about ||
                "Todavía no has escrito una descripción. Cuéntale a la comunidad quién eres y qué exploras."}
            </p>
            <div className="profile-meta">
              <span className="chip">
                MIEMBRO DESDE {formatDate(profile.createdAt).toUpperCase()}
              </span>
              <span className="chip">
                {data.messages.length} NOTAS EN EL RADAR
              </span>
              <span className="chip">
                {data.network.friends.length} AMIGOS
              </span>
            </div>
          </div>
          <div className="profile-hero-actions">
            {mode === "live" ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab("profile")}
                icon={<UserRound size={13} />}
              >
                EDITAR PERFIL
              </Button>
            ) : (
              <Link href="/login" className="btn btn-primary btn-sm">
                <LogIn size={13} />
                INICIAR SESIÓN
              </Link>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveTab("network")}
              icon={<Users size={13} />}
            >
              VER RED
            </Button>
          </div>
        </section>

        <section className="stat-strip" aria-label="Resumen de la cuenta">
          <article className="stat-card accent-dark">
            <span className="stat-label">Notas</span>
            <span className="stat-value">{data.messages.length}</span>
            <span className="stat-hint">{ownMessages} publicadas por ti</span>
          </article>
          <article className="stat-card accent-green">
            <span className="stat-label">Reputación</span>
            <span className="stat-value">{data.reputation.score}</span>
            <span className="stat-hint">
              Nivel {data.reputation.level} · {data.reputation.likesReceived} likes
            </span>
          </article>
          <article className="stat-card accent-blue">
            <span className="stat-label">Red</span>
            <span className="stat-value">{data.network.friends.length}</span>
            <span className="stat-hint">
              {pendingRequests > 0
                ? `${pendingRequests} solicitudes pendientes`
                : "Sin solicitudes pendientes"}
            </span>
          </article>
          <article className="stat-card accent-red">
            <span className="stat-label">Última actividad</span>
            <span className="stat-value" style={{ fontSize: 18 }}>
              {relativeTime(lastActivity)}
            </span>
            <span className="stat-hint">Movimientos de reputación</span>
          </article>
        </section>

        <nav className="tabs" aria-label="Secciones de la cuenta">
          {PROFILE_TABS.map((tab) => {
            const Icon = tabIcons[tab.id];
            const count = tabCount(tab.id);
            const alert = tab.id === "network" && pendingRequests > 0;
            return (
              <button
                key={tab.id}
                type="button"
                className={`tab ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={14} />
                {tab.label}
                {count !== null ? (
                  <span className={`tab-count ${alert ? "alert" : ""}`}>
                    {alert ? pendingRequests : count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="tab-panel" key={activeTab}>
          {activeTab === "profile" ? (
            <ProfilePanel
              data={data}
              mode={mode}
              onData={setData}
              notify={notify}
            />
          ) : null}
          {activeTab === "explore" ? (
            <ExplorePanel
              data={data}
              mode={mode}
              onData={setData}
              notify={notify}
            />
          ) : null}
          {activeTab === "messages" ? (
            <MessagesPanel
              data={data}
              mode={mode}
              onData={setData}
              notify={notify}
            />
          ) : null}
          {activeTab === "reputation" ? (
            <ReputationPanel
              data={data}
              mode={mode}
              onData={setData}
              notify={notify}
            />
          ) : null}
          {activeTab === "network" ? (
            <NetworkPanel
              data={data}
              mode={mode}
              onData={setData}
              notify={notify}
            />
          ) : null}
        </div>
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <span>GEOPICTO // TU CUENTA</span>
          <span>ACTUALIZADO {relativeTime(data.loadedAt).toUpperCase()}</span>
          <span>ESTILO NINTENDO DS · PICTOCHAT</span>
        </div>
      </footer>

      {toast ? (
        <div className={`toast ${toast.tone === "info" ? "" : toast.tone}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
