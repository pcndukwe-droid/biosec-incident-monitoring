import WorkspaceShell from "../workspace-shell";
import TestEmailControl from "./test-email-control";
import { listNotifications, reportDataError, type NotificationRow } from "../../lib/monitoring-views";
export const dynamic="force-dynamic";
export default async function NotificationsPage(){
 let rows:NotificationRow[]=[];let failed=false;
 try{rows=await listNotifications();}catch(e){failed=true;reportDataError(e,"notifications");}
 return <WorkspaceShell section="Notifications">
   <section className="workspace-heading"><span className="eyebrow">ALERT DELIVERY</span><h1>Notifications</h1><p>Review outage alerts, follow-up reminders, recovery notices and delivery outcomes.</p></section>
   <TestEmailControl />
   {failed&&<div className="settings-message">Notification history is temporarily unavailable. Check database connectivity.</div>}
   <section className="workspace-panel"><div className="workspace-panel-head"><div><h2>Email delivery history</h2><p>Most recent 100 alert attempts</p></div><span className="counter">{rows.length} entries</span></div>
   {!rows.length?<div className="workspace-empty"><h3>No notifications sent yet</h3><p>Configured email delivery attempts will appear here after monitoring is activated and an incident is detected.</p></div>:
   <div className="table-wrap"><table className="work-table"><thead><tr><th>Time</th><th>Event</th><th>Delivery</th><th>Recipients</th><th>Details</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.id}><td>{r.createdAt?new Date(r.createdAt).toLocaleString():"—"}</td><td><strong>{r.kind}</strong></td><td><span className={"status-chip "+(r.status==="SENT"?"up":r.status==="FAILED"?"down":"unknown")}>{r.status}</span></td><td>{r.recipients.join(", ")||"—"}</td><td>{r.error||"—"}</td></tr>)}
   </tbody></table></div>}</section>
 </WorkspaceShell>;
}