"use client";

import { useState } from "react";

export default function TestEmailControl() {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  async function send() {
    if (!window.confirm("Send one test email to the recipients currently saved in Settings?")) return;
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/notifications/test", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Test email failed");
      setMessage(json.message ?? "Test email accepted by SMTP server.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send test email");
    } finally {
      setSending(false);
    }
  }
  return <div style={{ margin: "12px 0 18px" }}>
    <button type="button" disabled={sending} onClick={send}>{sending ? "Sending..." : "Send Test Email"}</button>
    <p style={{ fontSize: 12, marginTop: 8 }}>Only sends when clicked. Uses the recipient saved in Settings and requires email delivery to be enabled.</p>
    {message && <p role="status" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{message}</p>}
  </div>;
}
