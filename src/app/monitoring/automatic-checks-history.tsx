"use client";

import { useEffect, useState } from "react";
import type { CheckHistoryRow } from "../../lib/monitoring-views";

type CheckPage = { rows: CheckHistoryRow[]; page: number; pageSize: number; pageCount: number; total: number };
const PAGE_SIZE = 20;
const stamp = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export default function AutomaticChecksHistory() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CheckPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), search: query });
    setLoading(true);
    setError("");
    fetch("/api/admin/monitoring/checks?" + params, {
      cache: "no-store", signal: controller.signal,
    }).then(async response => {
      const result: CheckPage & { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load scheduled checks");
      return result;
    }).then(result => {
      if (controller.signal.aborted) return;
      setData(result);
      if (result.page !== page) setPage(result.page);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load checks");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [page, query]);

  const rows = data?.rows || [];
  const total = data?.total ?? 0;
  const pageCount = data?.pageCount ?? 1;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return <section className="workspace-panel scheduled-checks-panel">
    <div className="workspace-panel-head scheduled-checks-heading">
      <div>
        <h2>Recent automatic checks</h2>
        <p>Scheduled check results; manual tests are not mixed into this history</p>
      </div>
      <div className="scheduled-checks-tools">
        <label className="scheduled-checks-search">
          <span className="sr-only">Search automatic checks</span>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input aria-label="Search automatic checks" type="search"
            placeholder="Search checks..." value={search}
            onChange={event => setSearch(event.target.value)} />
        </label>
        <span className="counter">{total} checks</span>
      </div>
    </div>

    {error && <div className="settings-message" role="alert">{error}</div>}
    {!loading && !rows.length ? <div className="workspace-empty">
      <h3>{query ? "No matching checks" : "No scheduled checks yet"}</h3>
      <p>{query ? "Try a different endpoint, result, HTTP code or error term." : "Checks appear here once endpoint monitoring is activated and scheduled checks run."}</p>
    </div> : <>
      <div className="table-wrap">
        <table className="work-table scheduled-checks-table">
          <thead><tr><th>S/N</th><th>Time</th><th>Endpoint</th><th>Result</th><th>HTTP</th><th>Response time</th><th>Details</th></tr></thead>
          <tbody>{rows.map((check, index) => <tr key={check.id}>
            <td className="scheduled-checks-number">{(page - 1) * PAGE_SIZE + index + 1}</td>
            <td>{stamp(check.checkedAt)}</td>
            <td><strong>{check.service}</strong></td>
            <td><span className={"status-chip " + (check.healthy ? "up" : "down")}>{check.healthy ? "PASS" : "FAIL"}</span></td>
            <td>{check.httpStatus ?? "—"}</td>
            <td>{check.latencyMs === null ? "—" : check.latencyMs + " ms"}</td>
            <td>{check.error ?? "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <div className="scheduled-checks-pagination">
      <span aria-live="polite">{loading ? "Loading checks..." : "Showing " + first + "–" + last + " of " + total + " records"}</span>
      <div className="scheduled-checks-page-buttons">
        <button type="button" disabled={loading || page <= 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button type="button" disabled={loading || page >= pageCount} onClick={() => setPage(previous => Math.min(pageCount, previous + 1))}>Next</button>
      </div>
    </div>
  </section>;
}
