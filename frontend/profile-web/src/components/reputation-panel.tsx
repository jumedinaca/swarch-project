"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  History,
  RefreshCw,
  ShieldAlert,
  ShieldX,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { recomputeReputationAction } from "@/app/account/actions";
import { formatDateTime, relativeTime } from "@/lib/format";
import { levelLadder } from "@/lib/theme";
import { Button, EmptyState, PanelHeader } from "./ui";
import type { PanelProps } from "./panel-types";

const reasonLabels: Record<string, string> = {
  LIKE_RECEIVED: "Like recibido",
  DISLIKE_RECEIVED: "Dislike recibido",
  MESSAGE_ALLOWED: "Mensaje aprobado",
  MESSAGE_WARNED: "Mensaje con advertencia",
  MESSAGE_BLOCKED: "Mensaje bloqueado",
  RECOMPUTE: "Recálculo de reputación",
};

const rules = [
  { label: "Like recibido", delta: "+2" },
  { label: "Dislike recibido", delta: "−2" },
  { label: "Mensaje aprobado", delta: "+1" },
  { label: "Mensaje con advertencia", delta: "−3" },
  { label: "Mensaje bloqueado", delta: "−10" },
  { label: "Revisión manual", delta: "0" },
];

export function ReputationPanel({ data, mode, onData, notify }: PanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const reputation = data.reputation;
  const progressPercent = Math.round(
    Math.max(0, Math.min(1, reputation.progress || 0)) * 100,
  );
  const nextLevel = levelLadder.find((level) => level.min > reputation.score);

  const handleRecompute = () => {
    if (mode === "demo") {
      notify("Reputación recalculada en la cuenta de ejemplo (sin cambios).", "success");
      return;
    }

    startTransition(async () => {
      const result = await recomputeReputationAction();
      if (result.ok) {
        notify(result.message ?? "Reputación recalculada.", "success");
        router.refresh();
      } else {
        notify(result.error ?? "No se pudo recalcular la reputación.", "error");
      }
    });
  };

  return (
    <div className="panel-grid">
      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="NIVEL DE EXPLORADOR"
            title="Reputación"
            subtitle="Puntos obtenidos por la calidad de tus notas y la reacción de la comunidad."
            aside={<Trophy size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="reputation-hero">
              <p className="panel-kicker" style={{ color: "rgba(255,255,255,.5)" }}>
                PUNTAJE ACTUAL
              </p>
              <p className="reputation-score">
                {reputation.score}
                <small>/ 1000 PTS</small>
              </p>
              <span className="reputation-level">
                <Sparkles size={11} />
                {reputation.level} · NIVEL {reputation.levelIndex + 1}
              </span>

              <div className="progress-track dark" style={{ marginTop: 14 }}>
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progress-caption">
                <span>
                  {nextLevel
                    ? `SIGUIENTE: ${nextLevel.name.toUpperCase()} A LOS ${nextLevel.min} PTS`
                    : "NIVEL MÁXIMO ALCANZADO"}
                </span>
                <span>{progressPercent}%</span>
              </div>
            </div>

            <div className="level-track">
              {levelLadder.map((level) => (
                <div
                  key={level.name}
                  className={[
                    "level-step",
                    reputation.level === level.name ? "current" : "",
                    reputation.score >= level.max ? "done" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="level-step-name">{level.name}</span>
                  <span className="level-step-range">
                    {level.min}–{level.max}
                  </span>
                </div>
              ))}
            </div>

            <div className="stat-mini-grid" style={{ marginTop: 12 }}>
              <div className="stat-mini">
                <div className="stat-mini-value">{reputation.likesReceived}</div>
                <div className="stat-mini-label">Likes recibidos</div>
              </div>
              <div className="stat-mini">
                <div className="stat-mini-value">{reputation.dislikesReceived}</div>
                <div className="stat-mini-label">Dislikes recibidos</div>
              </div>
              <div className="stat-mini">
                <div className="stat-mini-value">{reputation.messagesBlocked}</div>
                <div className="stat-mini-label">Mensajes bloqueados</div>
              </div>
              <div className="stat-mini">
                <div className="stat-mini-value">{reputation.messagesWarned}</div>
                <div className="stat-mini-label">Con advertencia</div>
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              ACTUALIZADO {formatDateTime(reputation.updatedAt).toUpperCase()}
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={isPending}
              onClick={handleRecompute}
              icon={<RefreshCw size={12} />}
            >
              RECALCULAR
            </Button>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            kicker="CÓMO GANAS PUNTOS"
            title="Cómo se calcula"
            subtitle="Cada acción suma o resta puntos a tu reputación."
            aside={<ShieldAlert size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="rules-grid">
              {rules.map((rule) => (
                <div className="rule-row" key={rule.label}>
                  <span>{rule.label}</span>
                  <span className={rule.delta.startsWith("+") ? "delta positive" : rule.delta === "0" ? "delta neutral" : "delta negative"}>
                    {rule.delta}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="panel-stack">
        <section className="panel">
          <PanelHeader
            kicker="HISTORIAL DE MOVIMIENTOS"
            title="Historial reciente"
            subtitle="Los últimos cambios registrados en tu cuenta."
            aside={<History size={17} color="#848E96" />}
          />
          <div className="panel-body tight">
            {data.history.length === 0 ? (
              <EmptyState
                icon={<ShieldX size={32} />}
                title="[ SIN MOVIMIENTOS ]"
                text="Cuando recibas likes o la moderación revise tus notas, los cambios aparecerán aquí."
              />
            ) : (
              <div>
                {data.history.map((entry) => (
                  <div className="history-row" key={entry.id}>
                    <span
                      className={`delta ${
                        entry.delta > 0
                          ? "positive"
                          : entry.delta < 0
                            ? "negative"
                            : "neutral"
                      }`}
                    >
                      {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                    </span>
                    <div className="history-main">
                      <div className="history-reason">
                        {reasonLabels[entry.reason] ?? entry.reason}
                      </div>
                      <div className="history-time">
                        {relativeTime(entry.createdAt).toUpperCase()}
                      </div>
                    </div>
                    <span className="history-score">
                      {entry.scoreAfter} PTS
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span className="mono-meta">
              <ThumbsUp size={11} /> {reputation.likesReceived} LIKES
            </span>
            <span className="mono-meta">
              <ThumbsDown size={11} /> {reputation.dislikesReceived} DISLIKES
            </span>
          </div>
        </section>

        <section className="panel">
          <PanelHeader
            kicker="PRÓXIMO OBJETIVO"
            title={nextLevel ? nextLevel.name : "Leyenda"}
            subtitle={
              nextLevel
                ? `Te faltan ${Math.max(0, nextLevel.min - reputation.score)} puntos para subir de nivel.`
                : "Estás en el nivel más alto del sistema."
            }
            aside={<Trophy size={17} color="#848E96" />}
          />
          <div className="panel-body">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-caption">
              <span>{reputation.score} PTS</span>
              <span>{nextLevel ? `${nextLevel.min} PTS` : "1000 PTS"}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
