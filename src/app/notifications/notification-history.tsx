"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationRow } from "../../lib/monitoring-views";

type PendingDeletion = { scope: "one"; id: string } | { scope: "all" };
type HistoryResponse = {
  page: number; pageSize: number; pageCount: number; total: number;
  rows: NotificationRow[];
};
type Props = { initialRows: NotificationRow[]; canManage: boolean };
const PAGE_SIZE = 20;

export default function NotificationHistory({ initialRows, canManage }: Props) {
  const [rows, setRows] = useState(initialRows.slice(0, PAGE_SIZE));
  const [total, setTotal] = useState(initialRows.length);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(Math.max(1, Math.ceil(initialRows.length / PAGE_SIZE)));
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  workingRef.current = working;
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); setQuery(search.trim()); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (targetPage: number, searchText: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage), search: searchText });
    const response = await fetch("/api/admin/notifications/history?" + params.toString(), { cache: "no-store", signal });
    const json: HistoryResponse & { error?: string } = await response.json();
    if (!response.ok) throw new Error(json.error || "Unable to load notification history");
    return json;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(page, query, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setRows(data.rows);
      setTotal(data.total);
      setPages(data.pageCount);
      if (data.page !== page) setPage(data.page);
      setError("");
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Unable to load notification history");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, query, load]);

  async function reload() {
    try {
      const data = await load(page, query);
      setRows(data.rows);
      setTotal(data.total);
      setPages(data.pageCount);
      if (data.page !== page) setPage(data.page);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to refresh history");
    }
  }

  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !workingRef.current) setPending(null);
      if (event.key === "Tab") {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".history-confirmation button:not(:disabled)"));
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (event.shiftKey && index === 0) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
        else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus.current?.focus(); };
  }, [pending]);

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
      setPending(null);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete history");
      setPending(null);
    } finally {
      setWorking(false);
    }
  }

  const completed = rows.filter(row => ["SENT", "FAILED", "CONFIGURATION_REQUIRED"].includes(row.status));
  const selected = pending?.scope === "one" ? rows.find(row => row.id === pending.id) : null;
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);

  return <>
    <section className="workspace-panel">
      <div className="workspace-panel-head history-panel-heading">
        <div><h2>Email delivery history</h2><p>Search and review notification delivery attempts</p></div>
        <div className="history-panel-actions">
          <span className="counter">{total} entries</span>
          {canManage && completed.length > 0 &&
            <button type="button" className="history-clear-button" onClick={() => askDelete({ scope: "all" })}>Clear history</button>}
        </div>
      </div>
      <div className="history-filter-bar">
        <label htmlFor="notification-history-search">Search delivery history</label>
        <div className="history-search-group">
          <input id="notification-history-search" type="search"
            value={search} onChange={event => setSearch(event.target.value)}
            placeholder="Search recipient, event, status or error..." />
          <button type="button" className="history-refresh-button" onClick={reload} disabled={loading}>Refresh</button>
        </div>
      </div>
      {error && <div role="alert" className="email-test-feedback email-test-error history-feedback">{error}</div>}
      {!rows.length ? <div className="workspace-empty"><h3>{query ? "No matching notifications" : "No email delivery history"}</h3><p>{query ? "Try another search term." : "Alert and test-email delivery attempts will appear here."}</p></div> :
        <div className="table-wrap"><table className="work-table"><thead><tr>
          <th>S/N</th><th>Time</th><th>Event</th><th>Delivery</th><th>Recipients</th><th>Details</th>{canManage && <th>Action</th>}
        </tr></thead><tbody>
          {rows.map((row, index) => <tr key={row.id}>
            <td className="history-serial">{(page - 1) * PAGE_SIZE + index + 1}</td>
            <td>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}</td>
            <td><strong>{row.kind}</strong></td>
            <td><span className={"status-chip " + (row.status === "SENT" ? "up" : row.status === "FAILED" ? "down" : "unknown")}>{row.status}</span></td>
            <td>{row.recipients.join(", ") || "—"}</td>
            <td>{row.error || "—"}</td>
            {canManage && <td>{row.status === "PENDING" ? <span className="history-pending-note">Processing</span> :
              <button type="button" className="history-row-delete" onClick={() => askDelete({ scope: "one", id: row.id })}>Delete</button>}</td>}
          </tr>)}
        </tbody></table></div>}
      <div className="history-pagination">
        <span>{loading ? "Loading..." : total ? "Showing " + from + "–" + to + " of " + total + " records" : "0 records"}</span>
        <div className="history-page-buttons">
          <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages || loading} onClick={() => setPage(current => Math.min(pages, current + 1))}>Next</button>
        </div>
      </div>
    </section>
    {pending && <div className="email-test-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !workingRef.current) setPending(null); }}>
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
