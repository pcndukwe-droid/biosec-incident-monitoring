// Cloudflare Workers SMTP transport. SMTP is disabled until both SMTP_ENABLED
// (Cloudflare) and emailEnabled (application settings) are explicitly enabled.
import type { MonitoringEnv } from "./server/monitoring-db";

type Socket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
  startTls(): Socket;
};

type SmtpReply = { code: number; lines: string[] };

function smtpReader(socket: Socket) {
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function line(): Promise<string> {
    while (!buffer.includes("\r\n")) {
      const next = await reader.read();
      if (next.done) throw new Error("SMTP server closed the connection");
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > 16384) throw new Error("SMTP response exceeds limit");
    }
    const index = buffer.indexOf("\r\n");
    const value = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    return value;
  }
  return {
    async reply(): Promise<SmtpReply> {
      const first = await line();
      if (!/^\d{3}[ -]/.test(first)) throw new Error("Invalid SMTP reply");
      const code = Number(first.slice(0, 3));
      const lines = [first];
      if (first[3] === "-") {
        for (let i = 0; i < 30; i++) {
          const next = await line();
          lines.push(next);
          if (next.startsWith(code + " ")) return { code, lines };
        }
        throw new Error("SMTP multi-line reply too long");
      }
      return { code, lines };
    },
    release() { reader.releaseLock(); },
  };
}

async function write(socket: Socket, text: string): Promise<void> {
  const writer = socket.writable.getWriter();
  try { await writer.write(new TextEncoder().encode(text)); }
  finally { writer.releaseLock(); }
}

function expect(reply: SmtpReply, allowed: number[]): void {
  if (!allowed.includes(reply.code)) throw new Error("SMTP returned status " + reply.code);
}

function header(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 180);
}

function mailbox(value: string): string {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)) throw new Error("Invalid SMTP address");
  return value;
}

export function smtpConfigured(env: MonitoringEnv): boolean {
  return env.SMTP_ENABLED === "true" &&
    Boolean(env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD && env.SMTP_FROM);
}

export async function sendSmtpAlert(
  env: MonitoringEnv, recipients: string[], subject: string, body: string,
): Promise<void> {
  if (!smtpConfigured(env)) throw new Error("SMTP is not enabled or fully configured");
  const host = env.SMTP_HOST!;
  const port = Number(env.SMTP_PORT || "587");
  if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port !== 587)
    throw new Error("SMTP requires a valid host and port 587 STARTTLS");
  const sender = mailbox(env.SMTP_FROM!);
  recipients = recipients.map(mailbox);
  if (!recipients.length || recipients.length > 10) throw new Error("Invalid SMTP recipients");
  const username = env.SMTP_USERNAME!;
  const password = env.SMTP_PASSWORD!;
  // Import only during a real delivery. Next.js evaluates route modules in Node
  // while collecting build metadata; cloudflare:sockets exists only in Workers.
  // @ts-ignore Cloudflare runtime-only module is resolved in the deployed Worker.
  const { connect } = await import("cloudflare:sockets");
  const socket: Socket = connect({ hostname: host, port }, { secureTransport: "starttls" });
  let active = socket;
  let response = smtpReader(active);
  try {
    await active.opened;
    expect(await response.reply(), [220]);
    await write(active, "EHLO biosec-monitoring\r\n");
    const greeting = await response.reply();
    expect(greeting, [250]);
    if (!greeting.lines.some(line => /STARTTLS/i.test(line)))
      throw new Error("SMTP server did not advertise STARTTLS");
    await write(active, "STARTTLS\r\n");
    expect(await response.reply(), [220]);
    response.release();
    active = socket.startTls();
    await active.opened;
    response = smtpReader(active);
    await write(active, "EHLO biosec-monitoring\r\n");
    expect(await response.reply(), [250]);
    await write(active, "AUTH LOGIN\r\n");
    expect(await response.reply(), [334]);
    await write(active, btoa(username) + "\r\n");
    expect(await response.reply(), [334]);
    await write(active, btoa(password) + "\r\n");
    expect(await response.reply(), [235]);
    await write(active, "MAIL FROM:<" + sender + ">\r\n");
    expect(await response.reply(), [250]);
    for (const to of recipients) {
      await write(active, "RCPT TO:<" + to + ">\r\n");
      expect(await response.reply(), [250, 251]);
    }
    await write(active, "DATA\r\n");
    expect(await response.reply(), [354]);
    const message = [
      "From: " + header(env.SMTP_FROM_NAME || "Biosec Incident Monitoring") + " <" + sender + ">",
      "To: " + recipients.join(", "),
      "Subject: " + header(subject),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "", body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1.."),
    ].join("\r\n");
    await write(active, message + "\r\n.\r\n");
    expect(await response.reply(), [250]);
    // QUIT is best-effort after the server has accepted the message.
    try { await write(active, "QUIT\r\n"); } catch {}
  } finally {
    try { await active.close(); } catch {}
  }
}
