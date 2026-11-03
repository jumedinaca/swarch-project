import Link from "next/link";
import { Gamepad2 } from "lucide-react";

interface BrandProps {
  href?: string;
  subtitle?: string;
}

export function Brand({
  href = "/account",
  subtitle = "PERFIL · MENSAJES · REPUTACIÓN · RED",
}: BrandProps) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        <Gamepad2 size={19} />
      </span>
      <span className="brand-text">
        <span className="brand-title">GEOPICTO // CUENTA</span>
        <span className="brand-subtitle">{subtitle}</span>
      </span>
    </>
  );

  if (!href) return <div className="brand">{content}</div>;
  return (
    <Link href={href} className="brand" aria-label="Ir al panel de cuenta">
      {content}
    </Link>
  );
}
