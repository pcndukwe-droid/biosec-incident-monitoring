import { type Db, ObjectId } from "mongodb";
import {
  ensureIndexes, normalizeSettings, readSettings, withMonitoringDb,
  type MonitoringEnv, type MonitoringSettings, type StoredMonitor,
} from "./server/monitoring-db";
import { validateMonitorTarget, verifyResponseJson } from "./server/monitor-config";
import { sendSmtpAlert, smtpConfigured } from "./smtp";

export type CheckResult = { healthy: boolean; latencyMs: number; httpStatus?: number; error?: string };

export async function performCheck(monitor: StoredMonitor): Promise<CheckResult> {
  const started = Date.now();
  try {
    if (monitor.type !== "https") throw new Error("Unsupported monitor type");
    // Revalidate at execution time: existing database records must obey the same
    // public HTTPS restrictions as new form submissions.
    const url = validateMonitorTarget(monitor.url);
    const method = monitor.method ?? "GET";
    if (method !== "GET" && method !== "POST") throw new Error("Unsupported HTTP method");
    if (method === "GET" && monitor.requestBody) throw new Error("GET monitors cannot include a request body");
    const check = monitor.responseCheck ?? "status";
    if (!["status","json-nonempty","json-field"].includes(check)) throw new Error("Invalid response check");
    if (check === "json-field" && !monitor.responseField) throw new Error("Missing JSON response field");
    const headers: Record<string,string> = { "User-Agent": "BiosecIncidentMonitor/1.0" };
    if (method === "POST") headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method, redirect: "manual", signal: AbortSignal.timeout(10000),
      headers,
      ...(method === "POST" ? { body: monitor.requestBody || "{}" } : {}),
    });
    const latencyMs = Date.now() - started;
    // Never follow redirects to arbitrary destinations. Treat redirects as a
    // failed probe even if an administrator configured a 3xx expected status.
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel();
      return { healthy: false, httpStatus: response.status, latencyMs,
        error: "Endpoint redirected (HTTP " + response.status + "); use a final canonical URL" };
    }
    if (response.status !== (monitor.expectedStatus ?? 200)) {
      void response.body?.cancel();
      return { healthy: false, httpStatus: response.status, latencyMs,
        error: "Unexpected HTTP status: " + response.status };
    }
    if (check === "status") {
      void response.body?.cancel();
      return { healthy: true, httpStatus: response.status, latencyMs };
    }
    // Avoid storing response content (including personal or pricing data).
    const text = await response.text();
    if (text.length > 65536) return { healthy:false, httpStatus:response.status, latencyMs,
      error:"Response exceeds 64 KB JSON validation limit" };
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { return { healthy:false, httpStatus:response.status, latencyMs, error:"Expected valid JSON response" }; }
    const healthy = verifyResponseJson(payload,check,monitor.responseField ?? null);
    return { healthy, httpStatus: response.status, latencyMs: Date.now()-started,
      ...(healthy ? {} : { error: "JSON response validation failed" }) };
  } catch (error) {
    return { healthy: false, latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function notify(
  db: Db, env: MonitoringEnv, settings: MonitoringSettings,
  incidentId: ObjectId, kind: "OPENED" | "RECOVERED" | "REMINDER", monitor: StoredMonitor,
  details: string,
): Promise<void> {
  if (!settings.emailEnabled || env.SMTP_ENABLED !== "true" || settings.alertRecipients.length === 0) return;
  const createdAt = new Date();
  const delivery = await db.collection("alert_notifications").insertOne({
    incidentId, monitorId: monitor._id, kind, recipients: settings.alertRecipients,
    status: "PENDING", createdAt,
  });
  if (!smtpConfigured(env)) {
    await db.collection("alert_notifications").updateOne({ _id: delivery.insertedId }, { $set: { status: "CONFIGURATION_REQUIRED" } });
    return;
  }
  try {
    const subject = "[BIOSEC] " + kind + ": " + monitor.name;
    const body = [
      "Biosec Incident Monitoring", "", "Service: " + monitor.name,
      "Status: " + kind, "Time: " + new Date().toISOString(),
      details, "", "This is an automated monitoring notification.",
    ].join("\\r\\n");
    await sendSmtpAlert(env, settings.alertRecipients, subject, body);
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
      { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }] },
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
        { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: now } }] },
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
    // Persist a scheduler heartbeat only after the master switch and database toggle
    // have both permitted execution. The dashboard uses this to distinguish
    // configured monitoring from a scheduler that is demonstrably running.
    await db.collection<{ _id: string; lastRunAt: Date; lastProcessedCount: number }>("monitoring_runtime").updateOne(
      { _id: "scheduler" },
      { $set: { lastRunAt: new Date(), lastProcessedCount: count } },
      { upsert: true },
    );
    console.info("Biosec scheduled check completed", { processed: count });
  });
}
