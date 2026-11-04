"use client";

import { useState } from "react";
import { Fingerprint, Search, UserRound } from "lucide-react";
import { lookupProfilesAction, searchProfilesAction } from "@/app/account/actions";
import { demoProfiles } from "@/lib/demo-data";
import { formatDate } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { Avatar } from "./avatar";
import { Button, EmptyState, Notice, PanelHeader } from "./ui";
import type { PanelProps } from "./panel-types";

type ExploreMode = "name" | "id";

function profileName(profile: Profile): string {
  return profile.displayName || profile.username;
}

function splitIds(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

function ProfileRow({
  profile,
  selected,
  onSelect,
}: {
  profile: Profile;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`friend-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <Avatar
        name={profileName(profile)}
        color={profile.color}
        avatarUrl={profile.avatarUrl}
        size="md"
      />
      <div className="friend-info">
        <div className="friend-name">{profileName(profile)}</div>
        <span className="friend-handle">@{profile.username}</span>
      </div>
    </button>
  );
}

function ProfileDetail({ profile, isMe }: { profile: Profile; isMe: boolean }) {
  return (
    <div className="profile-detail">
      <Avatar
        name={profileName(profile)}
        color={profile.color}
        avatarUrl={profile.avatarUrl}
        size="xl"
      />
      <div className="profile-detail-main">
        <div className="profile-name-row">
          <h3 className="profile-name" style={{ fontSize: 18 }}>
            {profileName(profile)}
          </h3>
          {isMe ? <span className="chip chip-blue">TÚ</span> : null}
        </div>
        <p className="profile-handle">@{profile.username}</p>
        <p className="profile-about">
          {profile.about || "Este explorador todavía no ha escrito una descripción."}
        </p>
        <div className="profile-meta">
          <span className="chip">
            MIEMBRO DESDE {formatDate(profile.createdAt).toUpperCase()}
          </span>
          <span className="chip">COLOR {profile.color}</span>
        </div>
        <div className="id-card">
          <span className="section-label">ID DE EXPLORADOR</span>
          <div className="id-value">{profile.userId}</div>
        </div>
      </div>
    </div>
  );
}

export function ExplorePanel({ data, mode, notify }: PanelProps) {
  const [exploreMode, setExploreMode] = useState<ExploreMode>("name");
  const [query, setQuery] = useState("");
  const [idsText, setIdsText] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const selected = results.find((profile) => profile.userId === selectedId) ?? null;

  const showResults = (profiles: Profile[]) => {
    setResults(profiles);
    setSelectedId(profiles.length === 1 ? profiles[0].userId : null);
    setHasSearched(true);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const byName = exploreMode === "name";
    const clean = (byName ? query : idsText).trim();

    if (byName && clean.length < 2) {
      notify("Escribe al menos 2 caracteres del nombre de usuario.", "warn");
      return;
    }
    if (!byName && !clean) {
      notify("Escribe al menos un id de explorador.", "warn");
      return;
    }

    setPending(true);
    try {
      if (mode === "demo") {
        const all = Object.values(demoProfiles());
        if (byName) {
          const needle = clean.toLowerCase();
          showResults(
            all.filter(
              (profile) =>
                profile.username.toLowerCase().includes(needle) ||
                (profile.displayName ?? "").toLowerCase().includes(needle),
            ),
          );
        } else {
          const ids = splitIds(clean);
          showResults(all.filter((profile) => ids.includes(profile.userId)));
        }
        return;
      }

      const result = byName
        ? await searchProfilesAction(clean, 50)
        : await lookupProfilesAction(splitIds(clean));
      if (!result.ok) {
        notify(result.error ?? "No se pudo consultar el perfil.", "error");
        return;
      }
      showResults(result.profiles ?? []);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="panel">
      <PanelHeader
        kicker="DIRECTORIO"
        title="Explorar perfiles"
        subtitle="Consulta a otros exploradores por nombre o por id."
      />
      <div className="panel-body">
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${exploreMode === "name" ? "active" : ""}`}
            onClick={() => setExploreMode("name")}
          >
            POR NOMBRE
          </button>
          <button
            type="button"
            className={`sub-tab ${exploreMode === "id" ? "active" : ""}`}
            onClick={() => setExploreMode("id")}
          >
            POR ID
          </button>
        </div>

        <form className="form-stack" onSubmit={submit}>
          {exploreMode === "name" ? (
            <label className="field">
              <span className="field-label">Nombre visible o de usuario</span>
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ExploradorGeo"
                maxLength={50}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
          ) : (
            <label className="field">
              <span className="field-label">Ids de explorador</span>
              <textarea
                className="textarea input-mono"
                value={idsText}
                onChange={(event) => setIdsText(event.target.value)}
                placeholder="Uno o varios UUID separados por coma (máximo 100)"
                rows={3}
              />
              <span className="field-hint">
                Con un id se consulta ese perfil; con varios se consultan en lote.
              </span>
            </label>
          )}
          <Button
            type="submit"
            variant="mint"
            loading={pending}
            icon={exploreMode === "name" ? <Search size={14} /> : <Fingerprint size={14} />}
          >
            {exploreMode === "name" ? "BUSCAR EXPLORADORES" : "CONSULTAR PERFILES"}
          </Button>
        </form>

        {hasSearched && results.length === 0 && !pending ? (
          <EmptyState
            icon={<Search size={30} />}
            title="[ SIN RESULTADOS ]"
            text="No encontramos exploradores con esa consulta."
          />
        ) : null}

        {results.length > 1 ? (
          <div className="network-list" style={{ marginTop: 10 }}>
            <span className="section-label">{results.length} RESULTADOS</span>
            {results.map((profile) => (
              <ProfileRow
                key={profile.userId}
                profile={profile}
                selected={profile.userId === selectedId}
                onSelect={() => setSelectedId(profile.userId)}
              />
            ))}
          </div>
        ) : null}

        {selected ? (
          <div style={{ marginTop: 10 }}>
            <ProfileDetail profile={selected} isMe={selected.userId === data.profile.userId} />
          </div>
        ) : results.length > 1 ? (
          <div style={{ marginTop: 10 }}>
            <Notice tone="info" icon={false}>
              <UserRound size={12} style={{ verticalAlign: "-2px" }} /> Elige un resultado
              para ver su perfil completo.
            </Notice>
          </div>
        ) : null}
      </div>
    </div>
  );
}
