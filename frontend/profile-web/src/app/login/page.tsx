import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ expired?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  if (session) redirect("/account");

  const params = await searchParams;
  return <LoginForm expired={params.expired === "1"} />;
}
