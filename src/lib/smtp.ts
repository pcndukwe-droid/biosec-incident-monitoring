// Zoho SMTP transport via Cloudflare Workers' supported Node.js net/tls APIs.
// Delivery requires SMTP_ENABLED=true and application-level emailEnabled=true.
// Do not import cloudflare:sockets in Next.js server code: OpenNext cannot bundle it.
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { MonitoringEnv } from "./server/monitoring-db";

type SmtpReply = { code: number; lines: string[] };

class SmtpChannel {
  private buffer = "";
  private pending: (() => void) | null = null;
  private failure: Error | null = null;
  private readonly onData = (data: Buffer) => {
    this.buffer += data.toString("utf8");
    if (this.buffer.length > 65536) this.failure = new Error("SMTP response exceeds limit");
    this.wake();
  };
  private readonly onError = (error: Error) => {
    this.failure = error;
    this.wake();
  };
  private readonly onClose = () => {
    this.failure ||= new Error("SMTP connection closed");
    this.wake();
  };
  constructor(private readonly socket: Socket | TLSSocket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }
  private wake() {
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
  private async line(): Promise<string> {
    while (true) {
      const index = this.buffer.indexOf("\r\n");
      if (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        return line;
      }
      if (this.failure) throw this.failure;
      await new Promise<void>(resolve => { this.pending = resolve; });
    }
  }
  async reply(expected: number[]): Promise<SmtpReply> {
    const first = await this.line();
    if (!/^\d{3}[ -]/.test(first)) throw new Error("Invalid SMTP response");
    const code = Number(first.slice(0, 3));
    const lines = [first];
    if (first[3] === "-") {
      for (let count = 0; count < 30; count++) {
        const next = await this.line();
        if (!next.startsWith(String(code))) throw new Error("Invalid SMTP continuation");
        lines.push(next);
        if (next.startsWith(code + " ")) break;
        if (count === 29) throw new Error("SMTP response has too many lines");
      }
    }
    if (!expected.includes(code)) throw new Error("SMTP rejected command (code " + code + ")");
    return { code, lines };
  }
  async send(text: string): Promise<void> {
    if (this.failure) throw this.failure;
    await new Promise<void>((resolve, reject) => {
      this.socket.write(text, error => error ? reject(error) : resolve());
    });
  }
  dispose() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
    this.pending = null;
  }
}

function mailbox(value: string): string {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))
    throw new Error("Invalid SMTP email address");
  return value;
}
function header(value: string): string {
  return value.replace(/[\r\n]/g, " ").slice(0, 180);
}
export function smtpConfigured(env: MonitoringEnv): boolean {
  return env.SMTP_ENABLED === "true" &&
    Boolean(env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD && env.SMTP_FROM);
}

export async function sendSmtpAlert(
  env: MonitoringEnv, recipients: string[], subject: string, body: string,
): Promise<void> {
  if (!smtpConfigured(env)) throw new Error("SMTP is disabled or incompletely configured");
  const host = env.SMTP_HOST!;
  const port = Number(env.SMTP_PORT || "587");
  if (!/^[a-z0-9.-]+$/i.test(host) || port !== 587)
    throw new Error("SMTP expects a valid hostname and port 587 STARTTLS");
  if (env.SMTP_SECURE === "true")
    throw new Error("Port 587 uses STARTTLS; set SMTP_SECURE to false");
  const sender = mailbox(env.SMTP_FROM!);
  const destinations = recipients.map(mailbox);
  if (destinations.length === 0 || destinations.length > 10)
    throw new Error("SMTP requires 1 to 10 recipients");

  const socket = createConnection({ host, port });
  let channel = new SmtpChannel(socket);
  let tlsSocket: TLSSocket | undefined;
  try {
    await channel.reply([220]);
    await channel.send("EHLO biosec-monitoring\r\n");
    const welcome = await channel.reply([250]);
    if (!welcome.lines.some(line => /^250[ -]STARTTLS(?:\s|$)/i.test(line)))
      throw new Error("SMTP server does not support STARTTLS");
    await channel.send("STARTTLS\r\n");
    await channel.reply([220]);

    // Attach TLS to the existing connection; do not transmit credentials
    // until the TLS handshake has completed and the certificate is validated.
    channel.dispose();
    tlsSocket = connectTls({ socket, servername: host, rejectUnauthorized: true });
    await new Promise<void>((resolve, reject) => {
      tlsSocket!.once("secureConnect", resolve);
      tlsSocket!.once("error", reject);
    });
    if (!tlsSocket.authorized) throw new Error("SMTP TLS certificate validation failed");
    channel = new SmtpChannel(tlsSocket);
    await channel.send("EHLO biosec-monitoring\r\n");
    const capabilities = await channel.reply([250]);
    if (!capabilities.lines.some(line => /^250[ -]AUTH\b/i.test(line) && /\bLOGIN\b/i.test(line)))
      throw new Error("SMTP server does not offer AUTH LOGIN");
    await channel.send("AUTH LOGIN\r\n");
    await channel.reply([334]);
    await channel.send(Buffer.from(env.SMTP_USERNAME!, "utf8").toString("base64") + "\r\n");
    await channel.reply([334]);
    await channel.send(Buffer.from(env.SMTP_PASSWORD!, "utf8").toString("base64") + "\r\n");
    await channel.reply([235]);
    await channel.send("MAIL FROM:<" + sender + ">\r\n");
    await channel.reply([250]);
    for (const address of destinations) {
      await channel.send("RCPT TO:<" + address + ">\r\n");
      await channel.reply([250, 251]);
    }
    await channel.send("DATA\r\n");
    await channel.reply([354]);
    const message = [
      "From: " + header(env.SMTP_FROM_NAME || "Biosec Incident Monitoring") + " <" + sender + ">",
      "To: " + destinations.join(", "),
      "Subject: " + header(subject),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1.."),
    ].join("\r\n");
    await channel.send(message + "\r\n.\r\n");
    await channel.reply([250]);
    await channel.send("QUIT\r\n");
    await channel.reply([221]);
  } finally {
    channel.dispose();
    if (tlsSocket) tlsSocket.destroy();
    else socket.destroy();
  }
}
