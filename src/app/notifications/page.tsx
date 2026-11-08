import WorkspaceShell from "../workspace-shell";
import TestEmailControl from "./test-email-control";
import NotificationHistory from "./notification-history";
import { currentUser } from "../../lib/server/auth";
import { listNotifications, reportDataError, type NotificationRow } from "../../lib/monitoring-views";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  let rows: NotificationRow[] = [];
  let failed = false;
  try { rows = await listNotifications(); }
  catch (error) { failed = true; reportDataError(error, "notifications"); }
  const user = await currentUser();
  return <WorkspaceShell section="Notifications">
    <section className="workspace-heading"><span className="eyebrow">ALERT DELIVERY</span><h1>Notifications</h1><p>Review outage alerts, follow-up reminders, recovery notices and delivery outcomes.</p></section>
    {user?.role === "admin" && <TestEmailControl />}
    {failed && <div className="settings-message">Notification history is temporarily unavailable. Check database connectivity.</div>}
    <NotificationHistory initialRows={rows} canManage={user?.role === "admin"} />
  </WorkspaceShell>;
}
