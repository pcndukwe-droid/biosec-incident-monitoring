import { currentUser } from "../lib/server/auth";
import { redirect } from "next/navigation";

const navigation = ["Overview", "Monitors", "Incidents", "Reports", "Notifications", "Settings"];

const setupSteps = [
  { label: "Application deployed", note: "Cloudflare Worker + Next.js", done: true },
  { label: "Scheduled health checks", note: "1-minute scheduler heartbeat; checks disabled", done: true },
  { label: "Database integration", note: "MongoDB Atlas connection not yet configured", done: false },
  { label: "Incident notifications", note: "Support email integration pending", done: false },
  { label: "Admin authentication", note: "JWT login implemented; complete first-admin setup", done: true },
];

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand"><div className="brand-mark">B<span>.</span></div><div><strong>BIOSEC</strong><small>OPERATIONS</small></div></div>
        <div className="side-section">WORKSPACE</div>
        <nav>{navigation.map((item, index) => <span key={item} className={index === 0 ? "nav-item active" : "nav-item"}><span className="nav-dot" />{item === "Settings" ? <a href="/settings" style={{color:"inherit",textDecoration:"none"}}>Settings</a> : item}{item !== "Overview" && item !== "Settings" && <span className="soon">Soon</span>}</span>)}</nav>
        <div className="sidebar-foot"><span className="connection-dot" />System setup in progress<small>Biosec Solutions Limited</small></div>
      </aside>

      <main className="content">
        <header className="topbar"><div className="breadcrumbs">Operations <span>/</span> Overview</div><div className="environment"><span className="connection-dot" /> Production workspace</div></header>
        <section className="intro">
          <div><span className="eyebrow">INFRASTRUCTURE OBSERVABILITY</span><h1>Monitoring overview</h1><p>Monitor service availability, investigate incidents, and keep Biosec infrastructure reliable.</p></div>
          <div className="setup-label">INITIAL SETUP</div>
        </section>
        <div className="notice"><span className="notice-icon">i</span><div><strong>Monitoring is not yet active.</strong><p>This is the initial application shell. No server health checks or incident notifications are running until approved targets, access controls, and persistence are configured.</p></div></div>
        <section className="stat-grid" aria-label="Platform metrics">
          <article className="stat"><div className="stat-label">Registered monitors <span className="mini-icon">◫</span></div><div className="stat-value">0</div><div className="stat-note">No services configured</div></article>
          <article className="stat"><div className="stat-label">Active incidents <span className="mini-icon">!</span></div><div className="stat-value">—</div><div className="stat-note">Incident engine pending</div></article>
          <article className="stat"><div className="stat-label">Uptime (30 days) <span className="mini-icon">↗</span></div><div className="stat-value">—</div><div className="stat-note">No monitoring data available</div></article>
          <article className="stat"><div className="stat-label">Check schedule <span className="mini-icon">◷</span></div><div className="stat-value">10 <span className="unit">min</span></div><div className="stat-note">Default; configurable in Settings</div></article>
        </section>
        <div className="detail-grid">
          <section className="panel"><div className="panel-title"><div><h2>Monitored services</h2><p>Availability of your production endpoints and servers</p></div><span className="counter">0 services</span></div><div className="empty-state"><div className="empty-glyph">⌁</div><h3>No monitors configured</h3><p>Once the monitoring engine is connected, authorized Biosec administrators can register server IPs, TCP ports and application health endpoints.</p></div></section>
          <section className="panel"><div className="panel-title"><div><h2>Platform readiness</h2><p>Implementation progress</p></div></div><div className="steps">{setupSteps.map(step=><div className="step" key={step.label}><span className={step.done ? "step-icon done":"step-icon"}>{step.done ? "✓":"○"}</span><div><strong>{step.label}</strong><p>{step.note}</p></div></div>)}</div></section>
        </div>
        <footer className="main-footer"><span>© 2026 Biosec Solutions Limited</span><span>Internal infrastructure platform · <a href="/api/health">Application health</a></span></footer>
      </main>
    </div>
  );
}
