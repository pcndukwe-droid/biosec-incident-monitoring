import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../lib/server/auth";
import LogoutButton from "./logout-button";

type NavIconName = "overview" | "monitors" | "monitoring" | "incidents" | "reports" | "notifications" | "settings";

function NavIcon({ name }: { name: NavIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<NavIconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/></>,
    monitors: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m-5-9 3-3 2 2 4-4"/></>,
    monitoring: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    incidents: <><path d="m10.3 3-8.2 14.2A2 2 0 0 0 3.8 20h16.4a2 2 0 0 0 1.7-2.8L13.7 3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>,
    reports: <><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5H8Z"/><path d="M15 3v6h6M7 17v-3m4 3V9m4 8v-5"/></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12a2 2 0 0 0 4 0"/></>,
    settings: <><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.3h-2.8v-.3A1.7 1.7 0 0 0 11 18.6a1.7 1.7 0 0 0-1.9.3l-.1.1-2-2 .1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H5.5v-2.8h.3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L7 8.2l2-2 .1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.3h2.8V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 2 2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.3V14H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false" {...common}>{paths[name]}</svg>;
}

const pages = [
 {label:"Overview",icon:"overview" as const,href:"/"},
 {label:"Monitors",icon:"monitors" as const,href:"/monitors"},
 {label:"Monitoring",icon:"monitoring" as const,href:"/monitoring"},
 {label:"Incidents",icon:"incidents" as const,href:"/incidents"},
 {label:"Reports",icon:"reports" as const,href:"/reports"},
 {label:"Notifications",icon:"notifications" as const,href:"/notifications"},
 {label:"Settings",icon:"settings" as const,href:"/settings"},
];
export default async function WorkspaceShell({ section, children }: { section:string; children:React.ReactNode }) {
 const user = await currentUser();
 if(!user) redirect("/login");
 return <div className="app-shell">
  <aside className="sidebar" aria-label="Application navigation">
    <div className="brand"><div className="brand-mark">B<span>.</span></div><div><strong>BIOSEC</strong><small>OPERATIONS</small></div></div>
    <div className="side-section">WORKSPACE</div>
    <nav>{pages.filter(p=>p.label!=="Settings"||user.role==="admin").map(p=><Link key={p.href} href={p.href} className={"nav-item "+(section===p.label?"active":"")}><NavIcon name={p.icon}/><span>{p.label}</span></Link>)}</nav>
    <div className="sidebar-foot"><span className="connection-dot"/>Biosec monitoring workspace<small>Biosec Solutions Limited</small></div>
  </aside>
  <main className="content">
    <header className="topbar"><div className="breadcrumbs">Operations <span>/</span> {section}</div>
      <div className="environment"><span className="connection-dot"/> Production workspace <span style={{marginLeft:"12px",color:"#52715c"}}>{user.username}</span><LogoutButton/></div>
    </header>
    {children}
    <footer className="main-footer"><span>© 2026 Biosec Solutions Limited</span><span>Internal infrastructure platform · <Link href="/api/health">Application health</Link></span></footer>
  </main>
 </div>;
}
