"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [setup, setSetup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

      const raw = await response.text();
      let payload: { error?: string; diagnosticId?: string } = {};
      try { if (raw) payload = JSON.parse(raw) as typeof payload; } catch { /* An upstream HTML or empty response is not JSON. */ }
      if (!response.ok) {
        const fallback = response.status === 503 || response.status >= 500
          ? "Authentication service returned a server error"
          : "Unable to authenticate";
        throw new Error((payload.error ?? fallback) +
          " (HTTP " + response.status + ")" +
          (payload.diagnosticId ? " (Reference: " + payload.diagnosticId + ")" : ""));
      }
      if (!raw) throw new Error("Authentication service returned an empty response. Check Cloudflare Worker logs.");

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
        <label>Password
          <span className="auth-password-wrap">
            <input autoComplete={setup ? "new-password" : "current-password"}
              type={showPassword ? "text" : "password"} required minLength={setup ? 12 : 1} maxLength={128}
              value={password} onChange={e=>setPassword(e.target.value)}
              placeholder={setup ? "At least 12 characters" : "Your password"}/>
            <button className="auth-password-toggle" type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)}>
              {showPassword ? (
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8"/>
                  <path d="M9.9 5.2A10.8 10.8 0 0112 5c5.1 0 9 5.4 9 7a13 13 0 01-3.1 3.9M6.1 6.1C3.6 7.7 2 10.9 2 12c0 1.6 3.9 7 10 7a10.4 10.4 0 004.1-.8"/>
                </svg>
              ) : (
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </span>
        </label>
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
