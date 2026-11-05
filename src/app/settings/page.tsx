"use client";

import { useEffect, useState } from "react";
import AdminUsers from "./admin-users";

type FormState = {
  defaultIntervalMinutes: number;
  failureRecheckMinutes: number;
  failureThreshold: number;
  recoveryThreshold: number;
  reminderMinutes: number;
  alertRecipients: string[];
  monitoringEnabled: boolean;
  emailEnabled: boolean;
};

const initial: FormState = {
  defaultIntervalMinutes: 10, failureRecheckMinutes: 1, failureThreshold: 3, recoveryThreshold: 2,
  reminderMinutes: 5, alertRecipients: [], monitoringEnabled: false, emailEnabled: false,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<FormState>(initial);
  const [recipients, setRecipients] = useState("");
  const [message, setMessage] = useState("Loading protected settings...");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/settings", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to load settings");
        return data;
      }).then(data => {
        if (!active) return;
        setSettings(data.settings);
        setRecipients(data.settings.alertRecipients.join(", "));
        setMessage("");
        setReady(true);
      }).catch(err => { if (active) setMessage(String(err.message ?? err)); });
    return () => { active = false; };
  }, []);

  const changeNumber = (key: keyof FormState, value: string) =>
    setSettings(prev => ({ ...prev, [key]: Number(value) }));

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const updated = { ...settings, alertRecipients: recipients.split(/[;,\n]/).map(s => s.trim()).filter(Boolean) };
      const response = await fetch("/api/admin/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save");
      setSettings(result.settings);
      setMessage("Settings saved in MongoDB Atlas.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save settings");
    } finally {
      setSaving(false);
    }
  }

  return <main className="settings-shell">
    <div className="settings-top"><a href="/">← Monitoring overview</a><span>BIOSEC OPERATIONS</span></div>
    <div className="eyebrow">PLATFORM CONFIGURATION</div>
    <h1>Monitoring settings</h1>
    <p>Configure how often checks run, incident thresholds and where notification emails are sent. All settings are saved to MongoDB; credentials remain in Cloudflare secrets.</p>
    {message && <div className="settings-message" role="status">{message}</div>}
    <form onSubmit={save} className="settings-form">
      <h2>Scheduler and incident detection</h2>
      <div className="form-grid">
        {([
          ["defaultIntervalMinutes", "Routine check interval (minutes)", 1, 60],
          ["failureRecheckMinutes", "Failed check confirmation interval (minutes)", 1, 10],
          ["failureThreshold", "Failures before incident", 1, 20],
          ["recoveryThreshold", "Successes before recovery", 1, 20],
          ["reminderMinutes", "Reminder interval (minutes)", 5, 1440],
        ] as const).map(([key,label,min,max]) =>
          <label key={key}>{label}<input type="number" min={min} max={max} step="1" required disabled={!ready} value={settings[key]} onChange={event=>changeNumber(key,event.target.value)}/></label>
        )}
      </div>
      <p className="help">On the first failed check, the scheduler switches to rapid confirmation checks. After confirmed recovery it returns to the normal interval.</p>
      <h2>Email notifications</h2>
      <label>Incident recipients (comma-separated)
        <textarea value={recipients} disabled={!ready} onChange={event=>setRecipients(event.target.value)} rows={3} placeholder="support@example.com, operations@example.com"/>
      </label>
      <label className="toggle"><input type="checkbox" disabled={!ready} checked={settings.emailEnabled} onChange={event=>setSettings(prev=>({...prev,emailEnabled:event.target.checked}))}/> Enable email notifications</label>
      <label className="toggle"><input type="checkbox" disabled={!ready} checked={settings.monitoringEnabled} onChange={event=>setSettings(prev=>({...prev,monitoringEnabled:event.target.checked}))}/> Enable Endpoint Monitoring</label>
      <p className="help">Endpoint checks follow the intervals configured above. The underlying Cloudflare runtime also needs its monitoring permission enabled by the platform administrator. Gmail API delivery requires separate OAuth credentials in Cloudflare secrets.</p>
      <button disabled={!ready || saving} type="submit">{saving ? "Saving..." : "Save settings"}</button>
    </form>
    {ready && <AdminUsers />}
    <button className="logout-link" type="button" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});window.location.assign("/login");}}>Sign out</button>
  </main>;
}
