import WorkspaceShell from "../workspace-shell";
import { listIncidents, reportDataError, type IncidentRow } from "../../lib/monitoring-views";
export const dynamic="force-dynamic";
export default async function IncidentsPage(){
 let rows:IncidentRow[]=[];let failed=false;
 try{rows=await listIncidents();}catch(e){failed=true;reportDataError(e,"incidents");}
 return <WorkspaceShell section="Incidents">
   <section className="workspace-heading"><span className="eyebrow">OUTAGE HISTORY</span><h1>Incidents</h1><p>Confirmed service outages, recovery times and investigation records.</p></section>
   {failed&&<div className="settings-message">Incident history is temporarily unavailable. Check database connectivity.</div>}
   <section className="workspace-panel"><div className="workspace-panel-head"><div><h2>Incident history</h2><p>Most recent 100 incidents</p></div><span className="counter">{rows.length} records</span></div>
   {!rows.length?<div className="workspace-empty"><h3>No incidents recorded</h3><p>Confirmed outages will appear here when monitoring has been enabled and the scheduler records its first incident.</p></div>:
   <div className="table-wrap"><table className="work-table"><thead><tr><th>Service</th><th>Status</th><th>Started</th><th>Resolved</th><th>Failures</th><th>Details</th></tr></thead><tbody>
   {rows.map(r=><tr key={r.id}><td><strong>{r.service}</strong></td><td><span className={"status-chip "+(r.status==="OPEN"?"down":"up")}>{r.status}</span></td><td>{r.startedAt?new Date(r.startedAt).toLocaleString():"—"}</td><td>{r.resolvedAt?new Date(r.resolvedAt).toLocaleString():"—"}</td><td>{r.failures}</td><td>{r.details}</td></tr>)}
   </tbody></table></div>}</section>
 </WorkspaceShell>;
}