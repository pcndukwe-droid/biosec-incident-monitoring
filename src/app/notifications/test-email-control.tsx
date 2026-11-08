"use client";

import { useEffect, useRef, useState } from "react";

export default function TestEmailControl() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !sendingRef.current) {
        setConfirmOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [confirmOpen]);

  async function send() {
    if (sending) return;
    setSending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/notifications/test", { method: "POST" });
      const json: { error?: string; message?: string } = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Test email failed");
      setFailed(false);
      setMessage(json.message ?? "Test email submitted. Please check your inbox to confirm delivery.");
      setConfirmOpen(false);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Unable to send test email");
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  }

  return <section className="email-test-area" aria-label="Email delivery test">
    <button ref={triggerRef} className="email-test-trigger" type="button" disabled={sending} onClick={() => { setMessage(""); setConfirmOpen(true); }}>
      <svg className="notification-envelope" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg> Send Test Email
    </button>
    <p className="email-test-help">Send a single notification to the recipients saved in Settings. A test is sent only after confirmation.</p>
    {message && <div className={"email-test-feedback " + (failed ? "email-test-error" : "email-test-success")} role="status">
      <span className="email-feedback-symbol" aria-hidden="true">{failed ? "!" : "✓"}</span>
      <span>{message}</span>
    </div>}

    {confirmOpen && <div className="email-test-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !sending) setConfirmOpen(false); }}>
      <div className="email-test-dialog" role="dialog" aria-modal="true" aria-labelledby="email-test-dialog-title" aria-describedby="email-test-dialog-desc" onKeyDown={event => {
        if (event.key !== "Tab") return;
        const elements = [cancelRef.current, document.getElementById("email-test-confirm")].filter((element): element is HTMLElement => !!element);
        if (!elements.length) return;
        const activeIndex = elements.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && activeIndex === 0) { event.preventDefault(); elements[elements.length - 1].focus(); }
        if (!event.shiftKey && activeIndex === elements.length - 1) { event.preventDefault(); elements[0].focus(); }
      }}>
        <div className="email-test-dialog-icon" aria-hidden="true"><svg className="notification-envelope" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></div>
        <h2 id="email-test-dialog-title">Send test notification?</h2>
        <p id="email-test-dialog-desc">One test email will be sent to the recipient address currently saved in Monitoring Settings.</p>

        <div className="email-test-dialog-actions">
          <button ref={cancelRef} type="button" className="email-test-cancel" disabled={sending} onClick={() => setConfirmOpen(false)}>Cancel</button>
          <button id="email-test-confirm" type="button" className="email-test-confirm" disabled={sending} onClick={send}>{sending ? "Sending..." : "Send Test Email"}</button>
        </div>
      </div>
    </div>}
  </section>;
}
