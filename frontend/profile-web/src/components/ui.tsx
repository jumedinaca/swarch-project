import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  TriangleAlert,
} from "lucide-react";

type ButtonVariant = "primary" | "mint" | "danger" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  block = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "secondary" ? "" : `btn-${variant}`;
  return (
    <button
      type={type}
      className={[
        "btn",
        variantClass,
        size === "md" ? "" : `btn-${size}`,
        block ? "btn-block" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={13} className="spin" /> : icon}
      {children}
    </button>
  );
}

type NoticeTone = "info" | "success" | "error" | "warn" | "neutral";

interface NoticeProps {
  children: ReactNode;
  tone?: NoticeTone;
  icon?: boolean;
}

export function Notice({ children, tone = "neutral", icon = true }: NoticeProps) {
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "error"
        ? AlertCircle
        : tone === "warn"
          ? TriangleAlert
          : tone === "info"
            ? Info
            : null;

  return (
    <div className={`notice ${tone === "neutral" ? "" : `notice-${tone}`}`}>
      {icon && Icon ? <Icon size={14} style={{ flex: "none", marginTop: 1 }} /> : null}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-text">{text}</div>
    </div>
  );
}

export function PanelHeader({
  kicker,
  title,
  subtitle,
  aside,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="panel-header">
      <div className="panel-title-group">
        {kicker ? <p className="panel-kicker">{kicker}</p> : null}
        <h2 className="panel-title">{title}</h2>
        {subtitle ? <p className="panel-subtitle">{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}
