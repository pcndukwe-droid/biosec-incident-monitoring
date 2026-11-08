import { NextRequest } from "next/server";
import { requireApiUser, sameOrigin, throttle } from "../../../../../lib/server/auth";
import { readSettings, withMonitoringDb, type MonitoringEnv } from "../../../../../lib/server/monitoring-db";
import { sendSmtpAlert, smtpConfigured } from "../../../../../lib/smtp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Sends only after an authenticated administrator explicitly presses "Send Test Email".
// No cron job or deploy can invoke this endpoint.
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const auth = await requireApiUser(request, "admin");
  if (auth instanceof Response) return auth;
  const env = auth.env as MonitoringEnv;
  if (!smtpConfigured(env)) return Response.json({ error: "SMTP is disabled or incomplete in Cloudflare" }, { status: 409 });
  try {
    const reserved = await withMonitoringDb(env, async db => {
      if (!await throttle(db, "smtp-test:" + auth.user.id, 3)) {
        return { error: "Test email limit reached. Try again later.", status: 429 };
      }
      const settings = await readSettings(db);
      if (!settings.emailEnabled) return { error: "Enable email notifications in Settings first", status: 409 };
      if (!settings.alertRecipients.length) return { error: "Set a recipient in Settings first", status: 400 };
      const result = await db.collection("alert_notifications").insertOne({
        kind: "TEST", recipients: settings.alertRecipients, status: "PENDING", createdAt: new Date(),
      });
      return { id: result.insertedId, recipients: settings.alertRecipients };
    });
    if ("error" in reserved) return Response.json({ error: reserved.error }, { status: reserved.status });
    let sendError: string | null = null;
    try {
      await sendSmtpAlert(
        env, reserved.recipients,
        "[BIOSEC] Test notification",
        "Biosec Incident Monitoring\r\n\r\nThis is a manually requested test notification.\r\nIf this email arrives, the configured SMTP service accepted the message.\r\n",
      );
    } catch (error) {
      sendError = error instanceof Error ? error.message : "SMTP test failed";
    }
    await withMonitoringDb(env, async db => {
      await db.collection("alert_notifications").updateOne({ _id: reserved.id }, {
        $set: sendError ? { status: "FAILED", error: sendError.slice(0, 250) } : { status: "SENT", sentAt: new Date() },
      });
    });
    if (sendError) return Response.json({ error: sendError }, { status: 502 });
    return Response.json({ message: "Test email submitted. Please check your inbox to confirm delivery." });
  } catch (error) {
    console.error("Biosec SMTP test failed", error instanceof Error ? error.name : "Unknown");
    return Response.json({ error: "Unable to complete email test" }, { status: 503 });
  }
}
