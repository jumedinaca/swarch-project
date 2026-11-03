export default function AccountLoading() {
  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-text">
              <span className="brand-title">GEOPICTO // CUENTA</span>
              <span className="brand-subtitle">CARGANDO PERFIL…</span>
            </span>
          </div>
        </div>
      </header>
      <main className="account-layout">
        <div className="notice notice-info">Cargando tu cuenta…</div>
        <section className="profile-hero">
          <span className="avatar avatar-xl" style={{ background: "#E2DFD6", borderColor: "#CBC7BD" }} />
          <div className="profile-hero-main">
            <div className="profile-name" style={{ color: "#848E96" }}>
              Cargando explorador…
            </div>
          </div>
        </section>
        <section className="stat-strip">
          {[0, 1, 2, 3].map((item) => (
            <article className="stat-card" key={item}>
              <span className="stat-label">—</span>
              <span className="stat-value" style={{ color: "#CBC7BD" }}>
                …
              </span>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
