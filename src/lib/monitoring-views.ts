import { withMonitoringDb, readSettings } from "./server/monitoring-db";
import { getAuthEnv } from "./server/auth";

export type IncidentRow = {
 id:string; service:string; status:string; startedAt:string|null; resolvedAt:string|null;
 failures:number; details:string;
};
export type NotificationRow = {
 id:string; incidentId:string; kind:string; status:string;
 createdAt:string|null; recipients:string[]; error:string;
};
export type ReportSummary = {
 monitorCount:number; enabledCount:number; openIncidents:number;
 totalIncidents:number; sentEmails:number; failedEmails:number;
 checkCount:number; successfulChecks:number; uptimePercent:number|null; intervalMinutes:number;
};
const date=(v:unknown)=>v instanceof Date?v.toISOString():null;
const errorMessage=(e:unknown)=>e instanceof Error?e.name:"Unknown database error";

export async function monitoringOverview() {
 const env=await getAuthEnv();
 return withMonitoringDb(env, async db=>{
  const settings=await readSettings(db);
  const monitors=await db.collection("monitored_services").find({})
    .project({name:1,url:1,status:1,enabled:1,lastCheckedAt:1,lastHttpStatus:1})
    .sort({createdAt:-1}).limit(8).toArray();
  const total=await db.collection("monitored_services").countDocuments({});
  const enabledCount=await db.collection("monitored_services").countDocuments({enabled:true});
  const open=await db.collection("incidents").countDocuments({status:"OPEN"});
  const runtime=await db.collection<{ _id: string; lastRunAt: Date; lastProcessedCount: number }>("monitoring_runtime").findOne({_id:"scheduler"});
  const schedulerFresh=runtime?.lastRunAt instanceof Date &&
    Date.now()-runtime.lastRunAt.getTime()>=0 &&
    Date.now()-runtime.lastRunAt.getTime()<3*60_000;
  const monitoringActive=settings.monitoringEnabled && enabledCount>0 && schedulerFresh;
  return { settings, total, enabledCount, open, monitoringActive, monitors:monitors.map(m=>({
    id:String(m._id),name:String(m.name),url:String(m.url),
    status:String(m.status??"unknown"),enabled:m.enabled===true,
    lastCheckedAt:date(m.lastCheckedAt),lastHttpStatus:m.lastHttpStatus??null,
  })) };
 });
}
export async function listIncidents():Promise<IncidentRow[]> {
 const env=await getAuthEnv();
 return withMonitoringDb(env,async db=>{
  const rows=await db.collection("incidents").find({}).sort({startedAt:-1}).limit(100).toArray();
  return rows.map(r=>({
   id:String(r._id),service:String(r.monitorName??"Unknown service"),status:String(r.status??"OPEN"),
   startedAt:date(r.startedAt),resolvedAt:date(r.resolvedAt),failures:Number(r.failureCount??0),
   details:String(r.lastError??(r.lastHttpStatus?"HTTP "+r.lastHttpStatus:"—")).slice(0,200),
  }));
 });
}
export async function listNotifications():Promise<NotificationRow[]> {
 const env=await getAuthEnv();
 return withMonitoringDb(env,async db=>{
  const rows=await db.collection("alert_notifications").find({}).sort({createdAt:-1}).limit(100).toArray();
  return rows.map(r=>({
   id:String(r._id),incidentId:String(r.incidentId??""),kind:String(r.kind??""),
   status:String(r.status??""),createdAt:date(r.createdAt),
   recipients:Array.isArray(r.recipients)?r.recipients.filter((v:unknown)=>typeof v==="string"):[],
   error:String(r.error??"").slice(0,200),
  }));
 });
}
export async function getReportSummary():Promise<ReportSummary> {
 const env=await getAuthEnv();
 return withMonitoringDb(env,async db=>{
  const since=new Date(Date.now()-30*86400_000);
  const [monitorCount,enabledCount,openIncidents,totalIncidents,sentEmails,failedEmails,checkCount,successfulChecks,settings]=await Promise.all([
   db.collection("monitored_services").countDocuments({}),
   db.collection("monitored_services").countDocuments({enabled:true}),
   db.collection("incidents").countDocuments({status:"OPEN"}),
   db.collection("incidents").countDocuments({}),
   db.collection("alert_notifications").countDocuments({status:"SENT"}),
   db.collection("alert_notifications").countDocuments({status:"FAILED"}),
   db.collection("health_checks").countDocuments({checkedAt:{$gte:since}}),
   db.collection("health_checks").countDocuments({checkedAt:{$gte:since},healthy:true}),
   readSettings(db),
  ]);
  return {monitorCount,enabledCount,openIncidents,totalIncidents,sentEmails,failedEmails,
    checkCount,successfulChecks,uptimePercent:checkCount?100*successfulChecks/checkCount:null,
    intervalMinutes:settings.defaultIntervalMinutes};
 });
}
export function reportDataError(error:unknown,area:string) {
 console.error("biosec.data.error",{area,type:errorMessage(error)});
}
