"use client";
import { useEffect, useState, type FormEvent } from "react";

type Account = { id: string; username: string; role: "admin" | "operator" | "viewer"; enabled: boolean };

export default function AdminUsers() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Account["role"]>("viewer");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Could not load users");
    setAccounts(data.users);
  }
  useEffect(() => {
    refresh().catch(error => setMessage(error.message));
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password, role }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "User creation failed");
      setUsername(""); setPassword(""); setRole("viewer");
      await refresh();
      setMessage("Account created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create account"); }
    finally { setBusy(false); }
  }
  async function update(id: string, change: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...change }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Update failed");
      await refresh();
      setMessage("Account updated. Previous sessions were revoked.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update account"); }
    finally { setBusy(false); }
  }
  return <section className="settings-form user-settings">
    <h2>User accounts and permissions</h2>
    <p className="help">Only administrators can create users, change roles, or reset passwords. Usernames are unique; passwords are stored as salted hashes, never as plain text.</p>
    <form onSubmit={create} className="user-create">
      <label>New username<input required value={username} onChange={e=>setUsername(e.target.value)} pattern="[A-Za-z][A-Za-z0-9._-]{2,39}" placeholder="e.g. operations.admin" /></label>
      <label>New password<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 12 characters"/></label>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value as Account["role"])}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Administrator</option></select></label>
      <button type="submit" disabled={busy}>Create user</button>
    </form>
    {message && <p role="status" className="settings-message">{message}</p>}
    <div className="user-list">
      {accounts.map(account=><div className="user-record" key={account.id}>
        <div><strong>{account.username}</strong><small>{account.role} · {account.enabled ? "Active" : "Disabled"}</small></div>
        <div className="user-actions">
          <select aria-label={`Change role for ${account.username}`} value={account.role} disabled={busy} onChange={e=>update(account.id, {role:e.target.value})}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Administrator</option></select>
          <button type="button" disabled={busy} onClick={()=>{const next=window.prompt("New password (minimum 12 characters) for " + account.username);if(next)update(account.id,{password:next});}}>Reset password</button>
          <button type="button" disabled={busy} onClick={()=>update(account.id,{enabled:!account.enabled})}>{account.enabled?"Disable":"Enable"}</button>
        </div>
      </div>)}
    </div>
  </section>;
}
