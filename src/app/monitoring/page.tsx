import Link from "next/link";
import WorkspaceShell from "../workspace-shell";
import AutomaticChecksHistory from "./automatic-checks-history";
import { monitoringActivity,reportDataError } from "../../lib/monitoring-views";
export const dynamic="force-dynamic";
const stamp=(v:string|null)=>v?new Date(v).toLocaleString():"—";
export default async function MonitoringPage(){
 let data:Awaited<ReturnType<typeof monitoringActivity>>|null=null;
 try{data=await monitoringActivity();}catch(e){reportDataError(e,"monitoring-activity");}
 const running=Boolean(data?.monitoringEnabled&&data?.recentlyRunning&&data?.activity.some(m=>m.enabled));
 return <WorkspaceShell section="Monitoring">
  <section className="workspace-heading">
   <span className="eyebrow">LIVE MONITORING</span>
   <h1>Monitoring activity</h1>
   <p>See which endpoints are being checked, the latest automatic results and recent check history.</p>
  </section>
  {!data?<div className="settings-message">Monitoring activity is temporarily unavailable. Check MongoDB connectivity.</div>:
  <>
   <div className="notice"><span className="notice-icon">i</span><div>
    <strong>{running?"Automatic endpoint monitoring is running":data.monitoringEnabled?"Endpoint monitoring is configured, but no recent scheduler heartbeat is confirmed":"Automatic endpoint monitoring is currently disabled"}</strong>
    <p>Latest scheduler heartbeat: {stamp(data.lastRunAt)}. Manual tests are separate from automatic monitoring and do not affect incidents or scheduled status. Configure endpoints in <Link href="/monitors">Monitors</Link> and monitoring intervals in <Link href="/settings">Settings</Link>.</p>
   </div></div>
   <section className="workspace-panel">
    <div className="workspace-panel-head"><div><h2>Endpoint monitoring status</h2><p>Automatic checks only — live configuration from MongoDB</p></div><span className="counter">{data.activity.length} endpoints</span></div>
    <div className="table-wrap"><table className="work-table monitoring-activity-table">
     <thead><tr><th>Endpoint</th><th>Method</th><th>Monitor</th><th>Auto status</th><th>Last scheduled check</th><th>HTTP</th><th>Latency</th><th>Next scheduled</th></tr></thead>
     <tbody>{data.activity.map(m=><tr key={m.id}>
      <td><strong>{m.service}</strong><small className="monitor-url">{m.url}</small></td>
      <td>{m.method}</td>
      <td>{m.enabled?"Enabled":"Paused"}</td>
      <td><span className={"status-chip "+(m.lastCheckedAt?m.status:"unknown")}>{!m.enabled?"PAUSED":!m.lastCheckedAt?"Awaiting First Check":m.status==="unknown"?"Verifying":m.status.toUpperCase()}</span></td>
      <td>{stamp(m.lastCheckedAt)}</td>
      <td>{m.lastHttpStatus??"—"}</td>
      <td>{m.lastLatencyMs===null?"—":m.lastLatencyMs+" ms"}</td>
      <td>{m.enabled&&data.monitoringEnabled?stamp(m.nextCheckAt):"—"}</td>
     </tr>)}</tbody>
    </table></div>
    {!data.activity.length&&<div className="workspace-empty"><h3>No endpoints configured</h3><p>Start by registering an approved endpoint in Monitors.</p></div>}
   </section>
   <AutomaticChecksHistory />
  </>}
 </WorkspaceShell>;
}
