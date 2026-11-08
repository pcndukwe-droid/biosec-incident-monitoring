"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NotificationRow } from "../../lib/monitoring-views";

type PendingDeletion = { scope: "one"; id: string } | { scope: "all" };
type Props = { initialRows: NotificationRow[]; canManage: boolean };

export default function NotificationHistory({ initialRows, canManage }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { setRows(initialRows); }, [initialRows]);
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) setPending(null);
      if (event.key === "Tab") {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".history-confirmation button:not(:disabled)"));
        if (!buttons.length) return;
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && i === 0) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && i === buttons.length - 1) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus.current?.focus(); };
  }, [pending, working]);

  function askDelete(next: PendingDeletion) {
    previousFocus.current = document.activeElement as HTMLElement;
    setError("");
    setPending(next);
  }

  async function performDelete() {
    if (!pending || working) return;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/admin/notifications/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data: { deleted?: number; error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete history");
      if (pending.scope === "one") {
        const id = pending.id;
        setRows(current => current.filter(row => row.id !== id));
      } else {
        setRows(current => current.filter(row => row.status === "PENDING"));
      }
      setPending(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete history");
      setPending(null);
    } finally {
      setWorking(false);
    }
  }
  const completed = rows.filter(row => row.status !== "PENDING");
  const selected = pending?.scope === "one" ? rows.find(row => row.id === pending.id) : null;
  return <>
    <section className="workspace-panel">
      <div className="workspace-panel-head history-panel-heading">
        <div><h2>Email delivery history</h2><p>Most recent 100 alert attempts</p></div>
        <div className="history-panel-actions">
          <span className="counter">{rows.length} entries</span>
          {canManage && completed.length > 0 && <button type="button" className="history-clear-button" onClick={() => askDelete({ scope: "all" })}>Clear history</button>}
        </div>
      </div>
      {error && <div role="alert" className="email-test-feedback email-test-error history-feedback">{error}</div>}
      {!rows.length ? <div className="workspace-empty"><h3>No email delivery history</h3><p>Alert and test-email delivery attempts will appear here.</p></div> :
        <div className="table-wrap"><table className="work-table"><thead><tr><th>Time</th><th>Event</th><th>Delivery</th><th>Recipients</th><th>Details</th>{canManage && <th>Action</th>}</tr></thead><tbody>
          {rows.map(row => <tr key={row.id}>
            <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
            <td><strong>{row.kind}</strong></td>
            <td><span className={"status-chip " + (row.status === "SENT" ? "up" : row.status === "FAILED" ? "down" : "unknown")}>{row.status}</span></td>
            <td>{row.recipients.join(", ") || "—"}</td>
            <td>{row.error || "—"}</td>
            {canManage && <td>{row.status === "PENDING" ? <span className="history-pending-note">Processing</span> : <button type="button" className="history-row-delete" onClick={() => askDelete({ scope: "one", id: row.id })} aria-label={"Delete " + row.kind + " notification from " + (row.createdAt ? new Date(row.createdAt).toLocaleString() : "history")}>Delete</button>}</td>}
          </tr>)}
        </tbody></table></div>
      }
    </section>
    {pending && <div className="email-test-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !working) setPending(null); }}>
      <div className="email-test-dialog history-confirmation" role="dialog" aria-modal="true" aria-labelledby="history-delete-title" aria-describedby="history-delete-description">
        <div className="history-dialog-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6"/></svg></div>
        <h2 id="history-delete-title">{pending.scope === "all" ? "Clear delivery history?" : "Delete this delivery record?"}</h2>
        <p id="history-delete-description">{pending.scope === "all"
          ? "This permanently deletes completed email delivery records, including successful and failed attempts. Messages already delivered cannot be recalled."
          : "This permanently deletes the selected " + (selected?.kind || "email") + " delivery record. Messages already delivered cannot be recalled."}</p>
        <div className="email-test-dialog-actions">
          <button ref={cancelRef} type="button" className="email-test-cancel" disabled={working} onClick={() => setPending(null)}>Cancel</button>
          <button type="button" className="history-delete-confirm" disabled={working} onClick={performDelete}>{working ? "Deleting..." : pending.scope === "all" ? "Clear history" : "Delete record"}</button>
        </div>
      </div>
    </div>}
  </>;
}
