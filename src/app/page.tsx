export default function Home() {
  return (
    <main className="shell">
      <div className="eyebrow">BIOSEC SOLUTIONS LTD · INFRASTRUCTURE OBSERVABILITY</div>
      <header className="heading">
        <div>
          <h1>Incident Monitoring</h1>
          <p>One place to monitor infrastructure, endpoint availability, and production incidents.</p>
        </div>
        <span className="pill">Initial setup</span>
      </header>
      <section className="metrics" aria-label="Platform setup">
        <article><span>Platform</span><strong>Cloudflare</strong><small>Single Worker deployment</small></article>
        <article><span>Monitoring</span><strong>Not activated</strong><small>Awaiting approved targets</small></article>
        <article><span>Check frequency</span><strong>2 minutes</strong><small>Cloudflare Cron Trigger</small></article>
      </section>
      <section className="panel">
        <h2>Deployment initialized</h2>
        <p>The Biosec monitoring dashboard and scheduled Worker share the same project. Monitoring is deliberately disabled until database persistence, support notifications, authentication, and the approved endpoint inventory are configured.</p>
        <div className="checklist">
          <div><b>01</b> Next.js dashboard and health API scaffold</div>
          <div><b>02</b> Scheduled HTTP checks (disabled by default)</div>
          <div><b>03</b> Pending: MongoDB incidents, alert delivery, authenticated management</div>
        </div>
        <a href="/api/health">View application health endpoint</a>
      </section>
      <footer>© Biosec Solutions Ltd · Internal monitoring platform</footer>
    </main>
  );
}
