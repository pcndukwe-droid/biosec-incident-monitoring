import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../lib/server/auth";
import LogoutButton from "./logout-button";

const pages = [
 {label:"Overview",href:"/"},
 {label:"Monitors",href:"/monitors"},
 {label:"Incidents",href:"/incidents"},
 {label:"Reports",href:"/reports"},
 {label:"Notifications",href:"/notifications"},
 {label:"Settings",href:"/settings"},
];
export default async function WorkspaceShell({ section, children }: { section:string; children:React.ReactNode }) {
 const user = await currentUser();
 if(!user) redirect("/login");
 return <div className="app-shell">
  <aside className="sidebar" aria-label="Application navigation">
    <div className="brand"><div className="brand-mark">B<span>.</span></div><div><strong>BIOSEC</strong><small>OPERATIONS</small></div></div>
    <div className="side-section">WORKSPACE</div>
    <nav>{pages.filter(p=>p.label!=="Settings"||user.role==="admin").map(p=><Link key={p.href} href={p.href} className={"nav-item "+(section===p.label?"active":"")}><span className="nav-dot"/>{p.label}</Link>)}</nav>
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
