"use client";
import { useEffect, useState, type FormEvent } from "react";

type Monitor = {
 id:string; name:string; url:string; type:string; expectedStatus:number; enabled:boolean;
 method:"GET"|"POST"; requestBody:string|null; responseCheck:"status"|"json-nonempty"|"json-field"; responseField:string|null;
 intervalMinutes:number|null; status:"up"|"down"|"unknown";
 lastCheckedAt:string|null; lastHttpStatus:number|null; lastLatencyMs:number|null;
 lastError:string|null; nextCheckAt:string|null;
};
type Draft = { name:string; url:string; expectedStatus:number; enabled:boolean; intervalMinutes:string;
 method:"GET"|"POST"; requestBody:string; responseCheck:"status"|"json-nonempty"|"json-field"; responseField:string; };
type ManualTestResult = {
 monitorId:string; name:string; method:string; healthy:boolean; httpStatus:number|null;
 expectedStatus:number; latencyMs:number; validation:string; error:string|null; testedAt:string;
};
const empty:Draft={name:"",url:"",expectedStatus:200,enabled:false,intervalMinutes:"",method:"GET",requestBody:"",responseCheck:"status",responseField:""};
export default function MonitorManager({ canEdit }: {canEdit:boolean}) {
 const [items,setItems]=useState<Monitor[]>([]);
 const [draft,setDraft]=useState<Draft>(empty);
 const [editing,setEditing]=useState<string|null>(null);
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [testingId,setTestingId]=useState<string|null>(null);
 const [testResults,setTestResults]=useState<Record<string,ManualTestResult>>({});
 async function load() {
   const res=await fetch("/api/admin/monitors",{cache:"no-store"});
   const data=await res.json();
   if(!res.ok) throw Error(data.error||"Unable to load monitored services");
   setItems(data.monitors);
 }
 useEffect(()=>{load().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
 function startEdit(m:Monitor){
   setDraft({name:m.name,url:m.url,expectedStatus:m.expectedStatus,enabled:m.enabled,intervalMinutes:m.intervalMinutes===null?"":String(m.intervalMinutes),
     method:m.method??"GET",requestBody:m.requestBody??"",responseCheck:m.responseCheck??"status",responseField:m.responseField??""});
   setEditing(m.id);setOpen(true);setError("");setSuccess("");
 }
 function startAdd(){setDraft(empty);setEditing(null);setOpen(true);setError("");setSuccess("");}
 async function save(e:FormEvent<HTMLFormElement>){
   e.preventDefault();setBusy(true);setError("");setSuccess("");
   const payload={...draft,expectedStatus:Number(draft.expectedStatus),intervalMinutes:draft.intervalMinutes===""?null:Number(draft.intervalMinutes),
     requestBody:draft.method==="POST"?draft.requestBody:null,responseField:draft.responseCheck==="json-field"?draft.responseField:null};
   try{
     const res=await fetch("/api/admin/monitors",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(editing?{...payload,id:editing}:payload)});
     const data=await res.json();
     if(!res.ok) throw Error(data.error||"Unable to save monitor");
     await load();setOpen(false);setEditing(null);setSuccess(editing?"Monitor updated.":"Monitor registered.");
   }catch(e){setError(e instanceof Error?e.message:"Unable to save");}
   finally{setBusy(false);}
 }
 async function toggle(m:Monitor){
   setBusy(true);setError("");setSuccess("");
   try {
     const res=await fetch("/api/admin/monitors",{method:"PATCH",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({id:m.id,name:m.name,url:m.url,expectedStatus:m.expectedStatus,
         intervalMinutes:m.intervalMinutes,enabled:!m.enabled,method:m.method??"GET",requestBody:m.requestBody,
         responseCheck:m.responseCheck??"status",responseField:m.responseField,})});
     const d=await res.json();if(!res.ok)throw Error(d.error||"Unable to update");
     await load();setSuccess(m.enabled?"Monitor paused.":"Monitor enabled. Scheduled checks also require both global monitoring switches.");
   }catch(e){setError(e instanceof Error?e.message:"Unable to update");}
   finally{setBusy(false);}
 }
 async function testEndpoint(m:Monitor){
   if(testingId)return;
   setTestingId(m.id);setError("");setSuccess("");
   try{
     const response=await fetch("/api/admin/monitors/test",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({id:m.id}),cache:"no-store"
     });
     const raw=await response.text();
     let payload:Record<string,unknown>={};
     try{payload=JSON.parse(raw) as Record<string,unknown>;}catch{}
     if(!response.ok)throw Error(typeof payload.error==="string"?payload.error:"Manual test failed (HTTP "+response.status+")");
     setTestResults(prev=>({...prev,[m.id]:payload as unknown as ManualTestResult}));
   }catch(e){setError(e instanceof Error?e.message:"Unable to test endpoint");}
   finally{setTestingId(null);}
 }
 async function remove(m:Monitor){
   if(!window.confirm("Delete "+m.name+"? Historical incident records will remain."))return;
   setBusy(true);setError("");setSuccess("");
   try{
     const res=await fetch("/api/admin/monitors",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:m.id})});
     const d=await res.json();if(!res.ok)throw Error(d.error||"Unable to remove");
     await load();setSuccess("Monitor removed; historical records retained.");
   }catch(e){setError(e instanceof Error?e.message:"Unable to delete");}
   finally{setBusy(false);}
 }
 return <section className="workspace-panel">
   <div className="workspace-panel-head"><div><h2>Registered endpoints</h2><p>Secure HTTPS health checks and availability targets</p></div>
     {canEdit&&<button className="primary-action" onClick={startAdd}>+ Add endpoint</button>}</div>
   <p className="help">Configure GET or POST health probes to public HTTPS endpoints (port 443). POST requests must be safe to repeat and must not create transactions, send messages, or charge money. Never enter secrets or personal information in request bodies. New monitors start paused.</p>
   {error&&<div className="settings-message" role="alert">{error}</div>}
   {success&&<div className="inline-success" role="status">{success}</div>}
   {open&&canEdit&&<form className="monitor-form" onSubmit={save}>
     <h3>{editing?"Edit endpoint":"Add a monitored endpoint"}</h3>
     <div className="monitor-form-grid">
       <label>Service name<input required minLength={3} maxLength={100} value={draft.name} placeholder="eCitizen production API" onChange={e=>setDraft(v=>({...v,name:e.target.value}))}/></label>
       <label>Public HTTPS URL<input type="url" required value={draft.url} placeholder="https://api.example.com/health" onChange={e=>setDraft(v=>({...v,url:e.target.value}))}/></label>
       <label>Request method<select value={draft.method} onChange={e=>setDraft(v=>({...v,method:e.target.value as Draft["method"],requestBody:e.target.value==="GET"?"":v.requestBody}))}><option value="GET">GET</option><option value="POST">POST</option></select></label>
       <label>Validate response<select value={draft.responseCheck} onChange={e=>setDraft(v=>({...v,responseCheck:e.target.value as Draft["responseCheck"]}))}>
         <option value="status">HTTP status only</option><option value="json-nonempty">Valid non-empty JSON</option><option value="json-field">JSON field exists and is non-empty</option>
       </select></label>
       {draft.responseCheck==="json-field"&&<label>Required response field<input value={draft.responseField} required maxLength={160} placeholder="data.prices" onChange={e=>setDraft(v=>({...v,responseField:e.target.value}))}/></label>}
       <label>Expected HTTP status<input type="number" min={200} max={399} required value={draft.expectedStatus} onChange={e=>setDraft(v=>({...v,expectedStatus:Number(e.target.value)}))}/></label>
       <label>Check interval (minutes; blank = global default)<input type="number" min={1} max={60} value={draft.intervalMinutes} onChange={e=>setDraft(v=>({...v,intervalMinutes:e.target.value}))} placeholder="Use settings default"/></label>
     </div>
     {draft.method==="POST"&&<label className="monitor-json-label">JSON request body (optional)<textarea rows={5} maxLength={4096} spellCheck={false} placeholder={'{"ipAddress":"public-ip-here"}'} value={draft.requestBody} onChange={e=>setDraft(v=>({...v,requestBody:e.target.value}))}/></label>}
     <p className="help">The request is saved in your monitoring configuration and only executes when monitoring is activated. Use POST only for idempotent, non-billable read operations.</p>
     <label className="monitor-check"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft(v=>({...v,enabled:e.target.checked}))}/> Enable this monitor after saving</label>
     <div className="monitor-form-actions"><button className="primary-action" disabled={busy} type="submit">{busy?"Saving...":editing?"Save changes":"Save endpoint"}</button><button className="secondary-action" type="button" onClick={()=>setOpen(false)}>Cancel</button></div>
   </form>}
   {loading?<p className="muted">Loading monitors...</p>:items.length===0?
     <div className="workspace-empty"><h3>No endpoints registered yet</h3><p>Add your first approved public HTTPS health endpoint to begin configuring monitoring.</p></div>:
     <div className="table-wrap"><table className="work-table"><thead><tr><th>Service</th><th>Method</th><th>Endpoint</th><th>Status</th><th>Schedule</th><th>Last check</th><th>Actions</th></tr></thead>
       <tbody>{items.map(m=><tr key={m.id}>
         <td><strong>{m.name}</strong><small>{m.enabled?"Enabled":"Paused"}</small></td>
         <td><strong>{m.method??"GET"}</strong></td><td className="url-cell" title={m.url}>{m.url}</td>
         <td><span className={"status-chip "+m.status}>{m.status.toUpperCase()}</span></td>
         <td>{m.intervalMinutes??"Default"} min</td>
         <td>{m.lastCheckedAt?new Date(m.lastCheckedAt).toLocaleString():"Not checked"}</td>
         <td>{canEdit?<div className="table-actions"><button disabled={busy||testingId!==null} onClick={()=>testEndpoint(m)}>{testingId===m.id?"Testing...":"Test"}</button><button disabled={busy} onClick={()=>startEdit(m)}>Edit</button><button disabled={busy} onClick={()=>toggle(m)}>{m.enabled?"Pause":"Enable"}</button><button disabled={busy} onClick={()=>remove(m)}>Delete</button></div>:"View only"}</td>
       </tr>)}</tbody></table>
       {Object.keys(testResults).length>0&&<section className="manual-test-results" aria-label="Manual test results">
         <h3>Manual test results</h3>
         <p>One-time checks only. These results do not update scheduled monitoring status, open incidents or send alerts.</p>
         {items.filter(m=>testResults[m.id]).map(m=>{
           const t=testResults[m.id];
           return <div className="manual-test-result" key={m.id}>
             <strong>{m.name}</strong>
             <span className={"status-chip "+(t.healthy?"up":"down")}>{t.healthy?"PASS":"FAIL"}</span>
             <span>HTTP: {t.httpStatus??"No response"} (expected {t.expectedStatus})</span>
             <span>Time: {t.latencyMs} ms</span>
             <span>Validation: {t.validation}</span>
             <span>{new Date(t.testedAt).toLocaleString()}</span>
             {t.error&&<span className="test-failure-reason">Reason: {t.error}</span>}
           </div>;
         })}
       </section>}</div>}
 </section>;
}
