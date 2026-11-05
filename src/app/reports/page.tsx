import WorkspaceShell from "../workspace-shell";
import { getReportSummary, reportDataError, type ReportSummary } from "../../lib/monitoring-views";
export const dynamic="force-dynamic";
export default async function ReportsPage(){
 let data:ReportSummary|null=null;
 try{data=await getReportSummary();}catch(e){reportDataError(e,"reports");}
 const cards=[
  ["Registered monitors",data?.monitorCount??"—","All configured endpoints"],
  ["Enabled monitors",data?.enabledCount??"—","Per-service enabled status"],
  ["Total incidents",data?.totalIncidents??"—","All-time incident records"],
  ["Open incidents",data?.openIncidents??"—","Currently unresolved outages"],
  ["Health checks (30 days)",data?.checkCount??"—","Observed checks within the reporting window"],
  ["Successful checks (30 days)",data?.successfulChecks??"—","Checks marked healthy"],
  ["Uptime sample (30 days)",data?.uptimePercent===null||!data?"—":data.uptimePercent.toFixed(2)+"%","Check success ratio, not time-weighted SLA"],
  ["Email alerts sent",data?.sentEmails??"—","Total successful delivery attempts"],
  ["Email alerts failed",data?.failedEmails??"—","Total unsuccessful delivery attempts"],
 ];
 return <WorkspaceShell section="Reports"><section className="workspace-heading"><span className="eyebrow">OPERATIONS ANALYTICS</span><h1>Monitoring reports</h1><p>Live metrics calculated from incident, monitoring and health-check records in MongoDB.</p></section>
 {!data&&<div className="settings-message">Report metrics are temporarily unavailable. Check database connectivity.</div>}
 <div className="report-grid">{cards.map(([label,value,note])=><article className="stat" key={label}><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></article>)}</div>
 <div className="workspace-panel"><h2>Reporting methodology</h2><p className="help">The 30-day uptime sample is the percentage of successful health checks. It is not a time-weighted availability SLA. No data is shown as a dash rather than zero. Health-check records have a 90-day TTL; incident records remain available for historical analysis.</p></div>
 </WorkspaceShell>;
}