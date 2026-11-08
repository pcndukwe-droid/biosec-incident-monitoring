// Biosec-branded transactional email templates. Inline styles and table layout
// intentionally support Gmail, Outlook, and other mainstream email clients.
export type AlertKind = "TEST" | "OPENED" | "REMINDER" | "RECOVERED";
export type AlertContent = {
  kind: AlertKind;
  service?: string;
  url?: string;
  details?: string;
  time?: Date;
};

function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function readableTime(date: Date): string {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos",
  }).format(date) + " WAT";
}
export function renderAlertEmail(input: AlertContent): { subject: string; text: string; html: string } {
  const now = input.time ?? new Date();
  const service = input.service || "Notification delivery";
  const isTest = input.kind === "TEST";
  const titles: Record<AlertKind, string> = {
    TEST: "Test email delivered",
    OPENED: "Service outage detected",
    REMINDER: "Service remains unavailable",
    RECOVERED: "Service has recovered",
  };
  const statuses: Record<AlertKind, string> = {
    TEST: "TEST", OPENED: "DOWN", REMINDER: "STILL DOWN", RECOVERED: "RECOVERED",
  };
  const descriptions: Record<AlertKind, string> = {
    TEST: "This is a test notification from Biosec Incident Monitoring. Your email delivery configuration is working.",
    OPENED: "A monitored service has failed the configured consecutive health checks. An incident has been opened for investigation.",
    REMINDER: "The monitored service is still unavailable. This is a follow-up reminder for an ongoing incident.",
    RECOVERED: "The monitored service has passed the required recovery checks and the incident has been resolved.",
  };
  const title = titles[input.kind];
  const status = statuses[input.kind];
  const description = descriptions[input.kind];
  const detail = isTest ? "This message was sent manually to verify email notifications." :
    (input.details || (input.kind === "RECOVERED" ? "Service is responding normally." : "Monitoring detected an unsuccessful health check."));
  const time = readableTime(now);
  const subject = isTest ? "[BIOSEC] Test notification" :
    "[BIOSEC] " + (input.kind === "OPENED" ? "INCIDENT" : input.kind === "REMINDER" ? "REMINDER" : "RECOVERED") + ": " + service;
  const text = [
    "BIOSEC | INCIDENT MONITORING", "",
    title, description, "",
    "Service: " + service,
    "Status: " + status,
    ...(input.url ? ["Endpoint: " + input.url] : []),
    "Time: " + time,
    "Details: " + detail, "",
    isTest ? "This is an automated test message requested by an administrator." :
      "This is an automated operational alert. Please review the monitoring dashboard if action is required.",
    "", "Biosec Solutions Limited",
  ].join("\r\n");
  const accent = input.kind === "OPENED" || input.kind === "REMINDER" ? "#b42318" : "#087c3e";
  const pillBg = input.kind === "OPENED" || input.kind === "REMINDER" ? "#fff0ed" : "#e9f7ef";
  const safe = escapeHtml;
  const label = (value: string, key: string) =>
    '<tr><td style="padding:11px 12px;border-bottom:1px solid #e8efe9;color:#61786b;font-size:13px;width:110px;vertical-align:top;">' + key +
    '</td><td style="padding:11px 12px;border-bottom:1px solid #e8efe9;color:#1f3b2b;font-size:13px;overflow-wrap:anywhere;">' + safe(value) + '</td></tr>';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f6f3;font-family:Arial,Helvetica,sans-serif;color:#21372a;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f2f6f3;padding:28px 12px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #deebe1;border-radius:14px;overflow:hidden;">
<tr><td style="background:#123c28;padding:25px 30px;"><div style="color:#ffffff;font-size:21px;font-weight:bold;letter-spacing:1px;">BIOSEC</div><div style="color:#a8d3b9;font-size:11px;letter-spacing:2px;margin-top:5px;">INCIDENT MONITORING</div></td></tr>
<tr><td style="padding:30px;">
<div style="display:inline-block;background:${pillBg};color:${accent};font-weight:bold;font-size:11px;letter-spacing:1px;padding:8px 12px;border-radius:6px;">${safe(status)}</div>
<h1 style="font-size:23px;line-height:1.35;margin:17px 0 12px;color:#1c3527;">${safe(title)}</h1>
<p style="color:#53695d;font-size:14px;line-height:1.8;margin:0 0 22px;">${safe(description)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e1ece4;border-radius:9px;border-collapse:separate;border-spacing:0;background:#fbfdfb;">
${label(service,"Service")}${label(status,"Status")}${input.url ? label(input.url,"Endpoint") : ""}${label(time,"Time")}${label(detail,"Details")}
</table>
<p style="margin:24px 0 0;color:#718278;font-size:12px;line-height:1.7;">${isTest
  ? "This test confirms that this message reached your inbox."
  : "This alert was generated by automated service monitoring. Please review the dashboard and follow your incident response procedure."}</p>
</td></tr>
<tr><td style="border-top:1px solid #e2eee6;background:#f8fbf9;padding:20px 30px;color:#778b7e;font-size:11px;line-height:1.7;">Biosec Solutions Limited<br>Operational monitoring notification</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
