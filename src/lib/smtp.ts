// The Next.js app does not open TCP sockets. OpenNext bundles server code in
// Node during build; SMTP is delegated to the same Cloudflare Worker through
// its private, authenticated service binding.
import type { MonitoringEnv } from "./server/monitoring-db";

function validAddress(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}
export function smtpConfigured(env: MonitoringEnv): boolean {
  return env.SMTP_ENABLED === "true" &&
    Boolean(env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD &&
      env.SMTP_FROM && env.JWT_SECRET && env.WORKER_SELF_REFERENCE);
}
export async function sendSmtpAlert(
  env: MonitoringEnv, recipients: string[], subject: string, body: string, html?: string,
): Promise<void> {
  if (!smtpConfigured(env)) throw new Error("SMTP configuration or internal binding missing");
  if (!recipients.length || recipients.length > 10 || !recipients.every(validAddress))
    throw new Error("Invalid recipient list");
  const service = env.WORKER_SELF_REFERENCE!;
  const response = await service.fetch("https://biosec-internal.invalid/__internal/smtp-delivery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-biosec-smtp-secret": env.JWT_SECRET!,
    },
    body: JSON.stringify({ recipients, subject, body, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    let error = "SMTP transport failure";
    try {
      const data = await response.json() as { error?: string };
      if (data.error) error = data.error;
    } catch {}
    throw new Error(error);
  }
}
