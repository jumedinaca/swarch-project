import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GeoPicto · Cuenta",
    template: "%s · GeoPicto",
  },
  description:
    "Administra tu perfil, mensajes, reputación y red de amigos de GeoPicto.",
  applicationName: "GeoPicto Profile",
};

export const viewport: Viewport = {
  themeColor: "#F4F3EE",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
