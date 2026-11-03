import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountWorkspace } from "@/components/account-workspace";
import { Notice } from "@/components/ui";
import { loadLiveAccountData } from "@/lib/account";
import { DEMO_ACCOUNT } from "@/lib/demo-data";
import { GatewayError } from "@/lib/gateway";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Mi cuenta",
};

export const dynamic = "force-dynamic";

interface AccountPageProps {
  searchParams: Promise<{ demo?: string }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const session = await getSession();
  const params = await searchParams;

  if (!session) {
    if (params.demo === "1") {
      return <AccountWorkspace initialData={DEMO_ACCOUNT} mode="demo" />;
    }
    redirect("/login");
  }

  try {
    const data = await loadLiveAccountData(session);
    return <AccountWorkspace initialData={data} mode="live" />;
  } catch (error) {
    if (error instanceof GatewayError && error.status === 401) {
      redirect("/login?expired=1");
    }
    return (
      <div className="site-shell">
        <main className="account-layout">
          <Notice tone="error">
            No se pudo cargar tu cuenta. Vuelve a intentarlo en unos instantes.
          </Notice>
          <div className="inline-actions">
            <Link href="/account" className="btn btn-primary btn-sm">
              REINTENTAR
            </Link>
            <Link href="/login" className="btn btn-sm">
              VOLVER A INICIAR SESIÓN
            </Link>
          </div>
        </main>
      </div>
    );
  }
}
