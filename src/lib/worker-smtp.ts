// Cloudflare-native SMTP: imported exclusively by the outer Worker, never by
// the Next.js/OpenNext server bundle.
// @ts-ignore Cloudflare runtime module is resolved by the outer Worker bundler.
import { connect } from "cloudflare:sockets";
import type { MonitoringEnv } from "./server/monitoring-db";

type Socket = ReturnType<typeof connect>;
type SmtpReply = { code: number; lines: string[] };

class SmtpChannel {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffered = "";
  constructor(private readonly socket: Socket) {
    this.reader = socket.readable.getReader();
  }
  private async line(): Promise<string> {
    for (;;) {
      const index = this.buffered.indexOf("\r\n");
      if (index !== -1) {
        const line = this.buffered.slice(0, index);
        this.buffered = this.buffered.slice(index + 2);
        return line;
      }
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("SMTP server closed the connection");
      this.buffered += this.decoder.decode(chunk.value, { stream: true });
      if (this.buffered.length > 65536) throw new Error("SMTP response too long");
    }
  }
  async reply(expected: number[]): Promise<SmtpReply> {
    const first = await this.line();
    if (!/^\d{3}[ -]/.test(first)) throw new Error("Invalid SMTP response");
    const code = Number(first.slice(0, 3));
    const lines = [first];
    if (first[3] === "-") {
      let complete = false;
      for (let i = 0; i < 30; i++) {
        const next = await this.line();
        if (!next.startsWith(String(code))) throw new Error("Invalid SMTP continuation");
        lines.push(next);
        if (next.startsWith(code + " ")) { complete = true; break; }
      }
      if (!complete) throw new Error("SMTP response exceeded line limit");
    }
    if (!expected.includes(code)) throw new Error("SMTP server response " + code);
    return { code, lines };
  }
  async send(command: string): Promise<void> {
    const writer = this.socket.writable.getWriter();
    try { await writer.write(new TextEncoder().encode(command)); }
    finally { writer.releaseLock(); }
  }
  // Only used after a complete SMTP 220 response (no pending reads).
  releaseForUpgrade() {
    this.reader.releaseLock();
    if (this.buffered.length) throw new Error("Unexpected buffered SMTP data before TLS");
  }
  release() { try { this.reader.releaseLock(); } catch {} }
}

function mailbox(value: string): string {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))
    throw new Error("Invalid SMTP mailbox");
  return value;
}
function singleLine(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 180);
}
export async function deliverViaZoho(
  env: MonitoringEnv, recipients: string[], subject: string, body: string, html?: string,
): Promise<void> {
  const host = env.SMTP_HOST ?? "";
  const port = Number(env.SMTP_PORT || "587");
  if (!/^[a-z0-9.-]+$/i.test(host) || port !== 587 || env.SMTP_SECURE === "true")
    throw new Error("Invalid port 587 STARTTLS configuration");
  if (!env.SMTP_USERNAME || !env.SMTP_PASSWORD || !env.SMTP_FROM)
    throw new Error("SMTP credentials missing");
  if (recipients.length === 0 || recipients.length > 10) throw new Error("Invalid SMTP recipients");
  const from = mailbox(env.SMTP_FROM);
  const to = recipients.map(mailbox);
  const socket = connect({ hostname: host, port }, { secureTransport: "starttls" });
  let active = socket;
  let channel: SmtpChannel | undefined;
  try {
    await socket.opened;
    channel = new SmtpChannel(socket);
    await channel.reply([220]);
    await channel.send("EHLO biosec-monitoring\r\n");
    const initial = await channel.reply([250]);
    if (!initial.lines.some(line => /^250[ -]STARTTLS(?:\s|$)/i.test(line)))
      throw new Error("SMTP server did not advertise STARTTLS");
    await channel.send("STARTTLS\r\n");
    await channel.reply([220]);
    channel.releaseForUpgrade();
    channel = undefined;
    active = socket.startTls();
    await active.opened;
    channel = new SmtpChannel(active);
    await channel.send("EHLO biosec-monitoring\r\n");
    const secureGreeting = await channel.reply([250]);
    if (!secureGreeting.lines.some(line => /^250[ -]AUTH\b/i.test(line) && /\bLOGIN\b/i.test(line)))
      throw new Error("SMTP server did not offer LOGIN authentication");
    await channel.send("AUTH LOGIN\r\n");
    await channel.reply([334]);
    await channel.send(btoa(env.SMTP_USERNAME) + "\r\n");
    await channel.reply([334]);
    await channel.send(btoa(env.SMTP_PASSWORD) + "\r\n");
    await channel.reply([235]);
    await channel.send("MAIL FROM:<" + from + ">\r\n");
    await channel.reply([250]);
    for (const recipient of to) {
      await channel.send("RCPT TO:<" + recipient + ">\r\n");
      await channel.reply([250, 251]);
    }
    await channel.send("DATA\r\n");
    await channel.reply([354]);
    // MIME multipart/alternative ensures Outlook and Gmail display a branded
    // HTML layout, while plain-text clients retain a readable fallback.
    const boundary = "biosec-" + crypto.randomUUID().replace(/-/g, "");
    const base64 = (input: string) => {
      const bytes = new TextEncoder().encode(input);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 4096) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 4096));
      }
      return (btoa(binary).match(/.{1,76}/g) || []).join("\\r\\n");
    };
    const header = [
      "From: " + singleLine(env.SMTP_FROM_NAME || "Biosec Incident Monitoring") + " <" + from + ">",
      "To: " + to.join(", "),
      "Subject: " + singleLine(subject),
      "MIME-Version: 1.0",
    ];
    let message: string;
    if (html) {
      message = [
        ...header,
        'Content-Type: multipart/alternative; boundary="' + boundary + '"',
        "",
        "--" + boundary,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64(body),
        "--" + boundary,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64(html),
        "--" + boundary + "--",
      ].join("\\r\\n");
    } else {
      message = [
        ...header,
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "",
        base64(body),
      ].join("\\r\\n");
    }
    await channel.send(message + "\r\n.\r\n");
    await channel.reply([250]);
    await channel.send("QUIT\r\n");
    await channel.reply([221]);
  } finally {
    channel?.release();
    try { await active.close(); } catch {}
  }
}
