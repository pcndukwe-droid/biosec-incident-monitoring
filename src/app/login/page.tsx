"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch(setup ? "/api/auth/bootstrap" : "/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.toLowerCase().trim(), password, ...(setup ? { setupToken } : {}) }),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to authenticate");
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally { setBusy(false); }
  }
  return <main className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand"><div className="brand-mark">B<span>.</span></div><div><strong>BIOSEC</strong><small>INCIDENT MONITORING</small></div></div>
      <span className="eyebrow">SECURE OPERATIONS PORTAL</span>
      <h1>{setup ? "Initial administrator setup" : "Welcome back"}</h1>
      <p>{setup ? "Create the first administrator using the temporary bootstrap token configured in Cloudflare secrets." : "Sign in with your authorized Biosec username and password."}</p>
      <form onSubmit={submit} className="auth-form">
        <label>Username<input autoComplete="username" required minLength={3} maxLength={40} value={username} onChange={e=>setUsername(e.target.value)} placeholder="Your username"/></label>
        <label>Password<input autoComplete={setup ? "new-password" : "current-password"} type="password" required minLength={setup ? 12 : 1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={setup ? "At least 12 characters" : "Your password"}/></label>
        {setup && <label>One-time bootstrap token<input type="password" required value={setupToken} onChange={e=>setSetupToken(e.target.value)} placeholder="Cloudflare setup secret"/></label>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        <button disabled={busy} type="submit">{busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}</button>
      </form>
      <button type="button" className="auth-switch" onClick={()=>{setSetup(v=>!v);setError("");}}>
        {setup ? "Back to sign in" : "First-time setup (administrator only)"}
      </button>
      <div className="auth-foot">Biosec Solutions Limited · Authorized personnel only</div>
    </section>
  </main>;
}
