import Link from "next/link";
import WorkspaceShell from "./workspace-shell";
import { monitoringOverview, getReportSummary, reportDataError } from "../lib/monitoring-views";

export const dynamic = "force-dynamic";
const setupSteps = [
 {label:"Application deployed",note:"Cloudflare Worker + Next.js",done:true},
 {label:"Administrator authentication",note:"Secure JWT login and user management",done:true},
 {label:"Endpoint registration",note:"Public HTTPS monitor registry available",done:true},
 {label:"Scheduled health checks",note:"One-minute scheduler heartbeat; checks require activation",done:true},
 {label:"Email delivery",note:"Gmail OAuth credentials and testing required",done:false},
];

export default async function Home() {
 let overview:Awaited<ReturnType<typeof monitoringOverview>>|null=null;
 let summary:Awaited<ReturnType<typeof getReportSummary>>|null=null;
 try { [overview,summary]=await Promise.all([monitoringOverview(),getReportSummary()]); }
 catch(error){reportDataError(error,"overview");}
 const monitoringOn=overview?.settings.monitoringEnabled===true;
 return <WorkspaceShell section="Overview">
   <section className="intro">
     <div><span className="eyebrow">INFRASTRUCTURE OBSERVABILITY</span><h1>Monitoring overview</h1><p>Monitor service availability, investigate incidents, and keep Biosec infrastructure reliable.</p></div>
     <div className="setup-label">{monitoringOn?"CONFIGURED":"INITIAL SETUP"}</div>
   </section>
   {!overview?<div className="settings-message">Monitoring data could not be loaded. Check MongoDB connectivity.</div>:
     !monitoringOn?<div className="notice"><span className="notice-icon">i</span><div><strong>Monitoring is not yet active.</strong><p>You may register approved endpoints now. Scheduled health checks require both the database monitoring toggle and the Cloudflare master switch to be enabled after configuration and testing.</p></div></div>:
     <div className="notice"><span className="notice-icon">i</span><div><strong>Monitoring enabled in application settings.</strong><p>Actual scheduled execution also depends on the Cloudflare MONITORING_ENABLED master switch and valid approved monitors.</p></div></div>}
   <section className="stat-grid" aria-label="Platform metrics">
     <article className="stat"><div className="stat-label">Registered monitors <span className="mini-icon">◫</span></div><div className="stat-value">{overview?.total??"—"}</div><div className="stat-note">Configured endpoints</div></article>
     <article className="stat"><div className="stat-label">Active incidents <span className="mini-icon">!</span></div><div className="stat-value">{overview?.open??"—"}</div><div className="stat-note">Open incident records</div></article>
     <article className="stat"><div className="stat-label">Health checks (30 days) <span className="mini-icon">↗</span></div><div className="stat-value">{summary?.checkCount??"—"}</div><div className="stat-note">Observed checks</div></article>
     <article className="stat"><div className="stat-label">Check schedule <span className="mini-icon">◷</span></div><div className="stat-value">{overview?.settings.defaultIntervalMinutes??10} <span className="unit">min</span></div><div className="stat-note">Default; configurable in Settings</div></article>
   </section>
   <div className="detail-grid">
     <section className="panel"><div className="panel-title"><div><h2>Monitored services</h2><p>Availability of registered production endpoints</p></div><Link href="/monitors" className="counter">Manage monitors</Link></div>
     {overview?.monitors.length?<div className="overview-services">{overview.monitors.map(m=><div key={m.id} className="overview-service">
       <div><strong>{m.name}</strong><small>{m.url}</small></div>
       <span className={"status-chip "+m.status}>{m.enabled?m.status.toUpperCase():"PAUSED"}</span>
     </div>)}</div>:<div className="empty-state"><div className="empty-glyph">⌁</div><h3>No monitors configured</h3><p>Register an authorized public HTTPS application or API health endpoint.</p><Link className="primary-action" href="/monitors">Add first endpoint</Link></div>}
     </section>
     <section className="panel"><div className="panel-title"><div><h2>Platform readiness</h2><p>Implementation progress</p></div></div><div className="steps">{setupSteps.map(step=><div className="step" key={step.label}><span className={step.done?"step-icon done":"step-icon"}>{step.done?"✓":"○"}</span><div><strong>{step.label}</strong><p>{step.note}</p></div></div>)}</div></section>
   </div>
 </WorkspaceShell>;
}
