"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Gamepad2,
  LockKeyhole,
  MessageSquareText,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { loginAction, type LoginState } from "@/app/login/actions";
import { Brand } from "./brand";
import { Button, Notice } from "./ui";

interface LoginFormProps {
  expired?: boolean;
}

const initialState: LoginState = {};

const features = [
  { icon: UserRound, label: "PERFIL" },
  { icon: MessageSquareText, label: "MENSAJES" },
  { icon: Trophy, label: "REPUTACIÓN" },
  { icon: Users, label: "AMIGOS" },
];

export function LoginForm({ expired = false }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-page">
      <aside className="login-aside">
        <Brand href="/login" subtitle="PERFIL · MENSAJES · REPUTACIÓN · RED" />

        <div>
          <h1 className="login-headline">
            Tu cuenta <em>picto</em>, en una sola pantalla.
          </h1>
          <p className="login-copy">
            Administra tu perfil, tus notas del radar, tu reputación de explorador y
            tu red de amigos desde un solo lugar.
          </p>

          <div className="login-features" style={{ marginTop: 18 }}>
            {features.map(({ icon: Icon, label }) => (
              <span className="login-feature" key={label}>
                <Icon size={13} />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="login-feature" style={{ maxWidth: 320 }}>
          <Gamepad2 size={14} />
          MISMA ESTÉTICA QUE LA APP MÓVIL
        </div>
      </aside>

      <main className="login-main">
        <div className="login-card">
          <div className="login-card-header">
            <p className="panel-kicker">ACCESO DE EXPLORADOR</p>
            <h2 className="panel-title" style={{ fontSize: 18 }}>
              Iniciar sesión
            </h2>
            <p className="panel-subtitle">
              Usa las mismas credenciales de la aplicación móvil.
            </p>
          </div>

          <div className="login-card-body">
            {expired ? (
              <div style={{ marginBottom: 12 }}>
                <Notice tone="warn">
                  Tu sesión venció. Vuelve a iniciar sesión para administrar tu cuenta.
                </Notice>
              </div>
            ) : null}

            <form action={formAction} className="form-stack">
              <label className="field">
                <span className="field-label">Usuario o correo</span>
                <input
                  className="input"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="ExploradorGeo"
                  required
                />
              </label>

              <label className="field">
                <span className="field-label">Contraseña</span>
                <span className="password-wrap">
                  <input
                    className="input"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </span>
              </label>

              {state.error ? <Notice tone="error">{state.error}</Notice> : null}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={pending}
                icon={<LockKeyhole size={14} />}
              >
                {pending ? "CONECTANDO..." : "ENTRAR AL PANEL"}
              </Button>
            </form>

            <div className="divider">o conoce una cuenta de ejemplo</div>

            <Link href="/account?demo=1" className="btn btn-mint btn-block">
              <ArrowRight size={14} />
              EXPLORAR CUENTA DE EJEMPLO
            </Link>
          </div>

          <div className="login-card-footer">
            <span className="mono-meta">
              <LockKeyhole size={10} /> ACCESO SEGURO
            </span>
            <span className="mono-meta">GEOPICTO</span>
          </div>
        </div>
      </main>
    </div>
  );
}
