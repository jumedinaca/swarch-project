import type { CSSProperties } from "react";
import { colorForId, initials } from "@/lib/format";

interface AvatarProps {
  name: string;
  color?: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function Avatar({
  name,
  color,
  avatarUrl,
  size = "md",
  className = "",
}: AvatarProps) {
  const resolvedColor = color || colorForId(name || "?");
  return (
    <span
      className={`avatar avatar-${size} ${className}`.trim()}
      style={{ "--avatar-color": resolvedColor } as CSSProperties}
      title={name}
    >
      {avatarUrl ? (
        // Los avatares los sirve el API Gateway y pueden ser URLs absolutas externas.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={`Avatar de ${name}`} loading="lazy" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
