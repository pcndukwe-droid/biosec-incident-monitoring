import WorkspaceShell from "../workspace-shell";
import { currentUser } from "../../lib/server/auth";
import MonitorManager from "./monitor-manager";

export const dynamic = "force-dynamic";
export default async function MonitorsPage() {
 const user = await currentUser();
 return <WorkspaceShell section="Monitors">
   <section className="workspace-heading"><div><span className="eyebrow">INFRASTRUCTURE OBSERVABILITY</span><h1>Monitored services</h1><p>Register public HTTPS applications and API health endpoints, control check schedules and review their status.</p></div></section>
   <MonitorManager canEdit={user?.role==="admin"}/>
 </WorkspaceShell>;
}
