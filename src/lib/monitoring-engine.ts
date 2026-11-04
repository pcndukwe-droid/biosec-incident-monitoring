import { type Db, ObjectId } from "mongodb";
import {
  ensureIndexes, normalizeSettings, readSettings, withMonitoringDb,
  type MonitoringEnv, type MonitoringSettings, type StoredMonitor,
} from "./server/monitoring-db";

type CheckResult = { healthy: boolean; latencyMs: number; httpStatus?: number; error?: string };

function validateTarget(target: StoredMonitor): URL {
  if (target.type !== "https" || !target.url) throw new Error("Unsupported monitor type");
  const url = new URL(target.url);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Only approved HTTPS endpoints on port 443 are allowed");
  }
  return url;
}

async function performCheck(monitor: StoredMonitor): Promise<CheckResult> {
  const started = Date.now();
  try {
    const url = validateTarget(monitor);
    const response = await fetch(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "BiosecIncidentMonitor/1.0" },
    });
    return { healthy: response.status === (monitor.expectedStatus ?? 200), httpStatus: response.status, latencyMs: Date.now() - started };
  } catch (error) {
    return { healthy: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function notify(
  db: Db, env: MonitoringEnv, settings: MonitoringSettings,
  incidentId: ObjectId, kind: "OPENED" | "RECOVERED" | "REMINDER", monitor: StoredMonitor,
  details: string,
): Promise<void> {
  if (!settings.emailEnabled || settings.alertRecipients.length === 0) return;
  const createdAt = new Date();
  const delivery = await db.collection("alert_notifications").insertOne({
    incidentId, monitorId: monitor._id, kind, recipients: settings.alertRecipients,
    status: "PENDING", createdAt,
  });
  if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER) {
    await db.collection("alert_notifications").updateOne({ _id: delivery.insertedId }, { $set: { status: "CONFIGURATION_REQUIRED" } });
    return;
  }
  try {
    const params = new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token",
    });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: params, signal: AbortSignal.timeout(10000) });
    if (!tokenResponse.ok) throw new Error("Gmail OAuth token request failed: " + tokenResponse.status);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("Missing Gmail access token");
    const subject = "[BIOSEC] " + kind + ": " + monitor.name;
    const body = [
      "Biosec Incident Monitoring", "", "Service: " + monitor.name,
      "Status: " + kind, "Time: " + new Date().toISOString(),
      details, "", "This is an automated monitoring notification.",
    ].join("\r\n");
    const headers = [
      "From: " + env.GMAIL_SENDER,
      "To: " + settings.alertRecipients.join(", "),
      "Subject: " + subject,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "", body,
    ].join("\r\n");
    const raw = btoa(unescape(encodeURIComponent(headers))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(10000),
    });
    if (!sendResponse.ok) throw new Error("Gmail send failed: HTTP " + sendResponse.status);
    await db.collection("alert_notifications").updateOne({ _id: delivery.insertedId }, { $set: { status: "SENT", sentAt: new Date() } });
  } catch (error) {
    // Record the failure. Don't lose the original incident.
    const message = error instanceof Error ? error.message : "Unknown send failure";
    await db.collection("alert_notifications").updateOne({ _id: delivery.insertedId }, { $set: { status: "FAILED", error: message.slice(0, 250) } });
    console.error("Biosec notification delivery failed", message);
  }
}

async function transition(
  db: Db, env: MonitoringEnv, settings: MonitoringSettings,
  monitor: StoredMonitor, check: CheckResult, checkedAt: Date,
): Promise<"up" | "down" | "unknown"> {
  const failures = check.healthy ? 0 : (monitor.consecutiveFailures ?? 0) + 1;
  const successes = check.healthy ? (monitor.consecutiveSuccesses ?? 0) + 1 : 0;
  const status = monitor.status ?? "unknown";
  let nextStatus: "up" | "down" | "unknown" = status;
  if (!check.healthy && failures >= settings.failureThreshold) nextStatus = "down";
  else if (check.healthy && successes >= settings.recoveryThreshold) nextStatus = "up";
  await db.collection("monitored_services").updateOne({ _id: monitor._id }, {
    $set: { consecutiveFailures: failures, consecutiveSuccesses: successes, status: nextStatus, lastCheckedAt: checkedAt, lastLatencyMs: check.latencyMs, lastHttpStatus: check.httpStatus ?? null, lastError: check.error ?? null },
  });
  await db.collection("health_checks").insertOne({
    monitorId: monitor._id, checkedAt, healthy: check.healthy,
    latencyMs: check.latencyMs, httpStatus: check.httpStatus ?? null, error: check.error ?? null,
  });
  const incidents = db.collection("incidents");
  if (nextStatus === "down" && status !== "down") {
    const inserted = await incidents.insertOne({
      monitorId: monitor._id, monitorName: monitor.name, status: "OPEN",
      startedAt: checkedAt, lastFailureAt: checkedAt, failureCount: failures,
      lastError: check.error ?? null, lastHttpStatus: check.httpStatus ?? null,
      nextReminderAt: new Date(checkedAt.getTime() + settings.reminderMinutes * 60000),
    });
    await notify(db, env, settings, inserted.insertedId, "OPENED", monitor, check.error ?? "Service returned unexpected HTTP status");
  } else if (nextStatus === "up" && status === "down") {
    const current = await incidents.findOneAndUpdate(
      { monitorId: monitor._id, status: "OPEN" },
      { $set: { status: "RESOLVED", resolvedAt: checkedAt }, $currentDate: { updatedAt: true } },
      { sort: { startedAt: -1 }, returnDocument: "before" },
    );
    if (current) await notify(db, env, settings, current._id, "RECOVERED", monitor, "Service has recovered.");
  } else if (status === "down" && !check.healthy) {
    await incidents.updateOne(
      { monitorId: monitor._id, status: "OPEN" },
      { $set: { lastFailureAt: checkedAt }, $inc: { failureCount: 1 } },
    );
    if (settings.emailEnabled && settings.alertRecipients.length) {
      // Atomic reservation prevents duplicate reminders if invocations overlap.
      const reminder = await incidents.findOneAndUpdate(
        { monitorId: monitor._id, status: "OPEN", nextReminderAt: { $lte: checkedAt } },
        { $set: { nextReminderAt: new Date(checkedAt.getTime() + settings.reminderMinutes * 60000) } },
        { returnDocument: "after" },
      );
      if (reminder) await notify(db, env, settings, reminder._id, "REMINDER", monitor, "Service is still unavailable.");
    }
  }
  return nextStatus;
}

async function runDue(db: Db, env: MonitoringEnv, settings: MonitoringSettings): Promise<number> {
  const collection = db.collection<StoredMonitor>("monitored_services");
  const now = new Date();
  const due = await collection.find({
    enabled: true,
    $and: [
      { $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: { $lte: now } }] },
      { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] },
    ],
  }).limit(30).toArray();
  let processed = 0;
  for (const monitor of due) {
    const normalInterval = Number.isInteger(monitor.intervalMinutes) && monitor.intervalMinutes! >= 1 && monitor.intervalMinutes! <= 60
      ? monitor.intervalMinutes! : settings.defaultIntervalMinutes;
    let nextInterval = normalInterval;
    const reservation = await collection.updateOne({
      _id: monitor._id,
      enabled: true,
      $and: [
        { $or: [{ nextCheckAt: { $exists: false } }, { nextCheckAt: { $lte: now } }] },
        { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now } }] },
      ],
    }, { $set: { leaseUntil: new Date(now.getTime() + 60_000) } });
    if (!reservation.modifiedCount) continue;
    try {
      const check = await performCheck(monitor);
      const state = await transition(db, env, settings, monitor, check, new Date());
      // Switch to rapid confirmation on first failure; keep checking rapidly
      // during an active incident until recovery is confirmed.
      nextInterval = !check.healthy || state === "down" ? settings.failureRecheckMinutes : normalInterval;
      processed++;
    } catch (error) {
      console.error("Biosec monitor processing failed", monitor._id.toString(), error instanceof Error ? error.message : "unknown");
    } finally {
      await collection.updateOne({ _id: monitor._id }, {
        $set: { nextCheckAt: new Date(Date.now() + nextInterval * 60_000) },
        $unset: { leaseUntil: "" },
      });
    }
  }
  return processed;
}

export async function runScheduledChecks(env: MonitoringEnv): Promise<void> {
  // Master kill switch. Cron may execute before the platform has been configured.
  if (env.MONITORING_ENABLED !== "true") return;
  await withMonitoringDb(env, async db => {
    await ensureIndexes(db);
    const settings = normalizeSettings(await readSettings(db));
    if (!settings.monitoringEnabled) return;
    const count = await runDue(db, env, settings);
    console.info("Biosec scheduled check completed", { processed: count });
  });
}
