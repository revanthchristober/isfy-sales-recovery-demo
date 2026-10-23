"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Rep = { id: string; name: string };
type Recovery = { order_id: string; amount_cents: number } | null;
type Lead = {
  id: string;
  cart_id: string;
  customer_label: string;
  cart_amount_cents: number;
  is_eligible: boolean;
  status: "new" | "claimed" | "suppressed" | "recovered";
  assigned_rep_id: string | null;
  created_at: string;
  recovery: Recovery;
};
type Activity = { id: string; summary: string; created_at: string; action: string };
type Brand = {
  id: string;
  slug: string;
  name: string;
  reps: Rep[];
  leads: Lead[];
  recoveredRevenueCents: number;
  activity: Activity[];
};
type DemoState = { expiresAt: string; brands: Brand[] };

const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(cents / 100);

export default function DemoDashboard() {
  const [state, setState] = useState<DemoState | null>(null);
  const [activeBrandId, setActiveBrandId] = useState("");
  const [selectedRep, setSelectedRep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const brand = useMemo(() => state?.brands.find((item) => item.id === activeBrandId) ?? state?.brands[0], [state, activeBrandId]);

  const loadState = useCallback(async () => {
    const response = await fetch("/api/demo/state", { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error ?? "Could not load the demo.");
    const nextState = await response.json() as DemoState;
    setState(nextState);
    setActiveBrandId((current) => nextState.brands.some((item) => item.id === current) ? current : nextState.brands[0]?.id ?? "");
    setSelectedRep((current) => {
      const next = { ...current };
      for (const item of nextState.brands) if (!next[item.id] && item.reps[0]) next[item.id] = item.reps[0].id;
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await fetch("/api/demo/session", { method: "POST" });
        if (alive) await loadState();
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "The demo could not start.");
      }
    })();
    return () => { alive = false; };
  }, [loadState]);

  async function apiAction(key: string, path: string, body?: unknown) {
    setBusy(key);
    setNotice("");
    setError("");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const result = await response.json();
      if (result.message) setNotice(result.message);
      if (!response.ok && !result.message) throw new Error(result.error ?? "That action did not work.");
      await loadState();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action did not work.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function restart() {
    setBusy("restart");
    setError(""); setNotice("");
    try {
      const response = await fetch("/api/demo/session/reset", { method: "POST" });
      if (!response.ok) throw new Error("Could not start a fresh demo.");
      setState(null);
      await loadState();
      setNotice("Fresh demo started. Your previous session stayed separate.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start a fresh demo.");
    } finally { setBusy(""); }
  }

  async function recordSale(lead: Lead) {
    if (!brand) return;
    await apiAction(`sale-${lead.id}`, "/api/demo/scenarios", {
      scenario: "record_sale", brandId: brand.id, leadId: lead.id,
    });
  }

  if (error && !state) {
    return <main className="page-shell"><Topbar onRestart={restart} busy={busy} /><section className="intro"><p className="eyebrow">SALES RECOVERY WORKSPACE</p><h1>Turn missed checkouts into conversations.</h1><p className="intro-copy">{error} Set up the local Supabase values in <code>.env.local</code>, then reload this page.</p></section><SetupCard /></main>;
  }

  return (
    <main className="page-shell">
      <Topbar onRestart={restart} busy={busy} />
      <section className="intro">
        <div><p className="eyebrow">SALES RECOVERY WORKSPACE</p><h1>Turn missed checkouts into conversations.</h1>
          <p className="intro-copy">A small, hands-on demo of routing abandoned carts to reps and keeping recovered sales accurate.</p></div>
        <div className="revenue-card"><span>SIMULATED RECOVERED REVENUE</span><strong>{money(brand?.recoveredRevenueCents ?? 0)}</strong><small>Fake orders · no payments processed</small></div>
      </section>

      <div className="workspace-toolbar">
        <div className="brand-tabs" role="tablist" aria-label="Demo brands">
          {state?.brands.map((item) => <button key={item.id} role="tab" aria-selected={brand?.id === item.id}
            className={`brand-tab ${brand?.id === item.id ? "selected" : ""}`} onClick={() => setActiveBrandId(item.id)}>{item.name}</button>)}
        </div>
        <span className="session-chip"><i /> Private demo session · expires in 24 hours</span>
      </div>

      <section className="workspace-grid">
        <div className="main-column">
          <article className="panel inbox-panel">
            <div className="panel-heading"><div><p className="eyebrow">{brand?.name ?? "YOUR DEMO"}</p><h2>Lead inbox</h2></div>
              <span className="count-pill">{brand?.leads.length ?? 0} leads</span></div>
            <div className="quick-actions">
              <button className="button button-primary" disabled={!brand || !!busy} onClick={() => brand && apiAction("create", "/api/demo/scenarios", { scenario: "create_cart", brandId: brand.id })}>
                {busy === "create" ? "Adding…" : "+ Add fake cart"}
              </button>
              <button className="button button-secondary" disabled={!brand || !!busy} onClick={() => brand && apiAction("duplicate", "/api/demo/scenarios", { scenario: "duplicate_cart", brandId: brand.id })}>Try duplicate cart</button>
            </div>
            {notice && <p className="notice" role="status">{notice}</p>}
            {error && <p className="error-message" role="alert">{error}</p>}
            <div className="lead-list">
              {!state && !error && <div className="empty-state"><span className="spinner" /><p>Opening your private demo…</p></div>}
              {state && brand?.leads.length === 0 && <div className="empty-state"><span className="empty-icon">＋</span><h3>Your inbox is ready</h3><p>Add a fake cart to try the complete flow.</p></div>}
              {brand?.leads.map((lead) => {
                const assignedRep = brand.reps.find((rep) => rep.id === lead.assigned_rep_id);
                const isBusy = !!busy;
                return <article className="lead-card" key={lead.id}>
                  <div className="lead-card-top"><div><h3>{lead.customer_label}</h3><p>Cart <span className="mono">{lead.cart_id.slice(0, 22)}</span></p></div>
                    <strong className="cart-amount">{money(lead.cart_amount_cents)}</strong></div>
                  <div className="lead-meta"><span className={`eligibility ${lead.is_eligible ? "eligible" : "ineligible"}`}><i />{lead.is_eligible ? "Eligible to contact" : "Not eligible"}</span>
                    <span className={`lead-status status-${lead.status}`}>{lead.status.replace("_", " ")}</span>
                    <span className="owner-label">{assignedRep ? `Owner: ${assignedRep.name}` : "No owner"}</span></div>
                  {lead.recovery && <p className="recovery-note">Recovered sale · {money(lead.recovery.amount_cents)}</p>}
                  <div className="lead-actions">
                    {lead.status === "new" && lead.is_eligible && <><select aria-label={`Rep for ${lead.customer_label}`} value={selectedRep[brand.id] ?? ""} onChange={(event) => setSelectedRep({ ...selectedRep, [brand.id]: event.target.value })}>
                      {brand.reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select>
                      <button className="button button-small button-primary" disabled={isBusy} onClick={() => apiAction(`claim-${lead.id}`, `/api/demo/leads/${lead.id}/claim`, { brandId: brand.id, repId: selectedRep[brand.id] })}>Claim lead</button></>}
                    {lead.status === "claimed" && <button className="button button-small button-primary" disabled={isBusy} onClick={() => recordSale(lead)}>Simulate sale</button>}
                    {lead.status !== "suppressed" && <button className="button button-small button-quiet" disabled={isBusy} onClick={() => apiAction(`suppress-${lead.id}`, `/api/demo/leads/${lead.id}/suppress`, { brandId: brand.id })}>Suppress</button>}
                    {lead.status === "new" && lead.is_eligible && <button className="button button-small button-quiet" disabled={isBusy} onClick={() => apiAction(`race-${lead.id}`, "/api/demo/scenarios", { scenario: "competing_claim", brandId: brand.id, leadId: lead.id })}>Test two reps</button>}
                    {lead.status === "recovered" && <button className="button button-small button-quiet" disabled={isBusy} onClick={() => apiAction(`repeat-${lead.id}`, "/api/demo/scenarios", { scenario: "repeat_sale", brandId: brand.id, leadId: lead.id })}>Try repeated sale</button>}
                    {lead.status === "suppressed" && <span className="blocked-note">Contact blocked</span>}
                  </div>
                </article>;
              })}
            </div>
          </article>
        </div>
        <aside className="side-column">
          <article className="panel scenario-panel"><p className="eyebrow">QUICK SCENARIOS</p><h2>See the safeguards</h2><p className="side-copy">Each button uses fake events and keeps its result in this session.</p>
            <div className="scenario-row"><span className="scenario-icon">↻</span><div><strong>Duplicate cart</strong><small>One cart becomes one lead</small></div><button aria-label="Try duplicate cart" disabled={!brand || !!busy} onClick={() => brand && apiAction("duplicate-side", "/api/demo/scenarios", { scenario: "duplicate_cart", brandId: brand.id })}>Try</button></div>
            {brand?.leads.filter((lead) => lead.status === "new" && lead.is_eligible).slice(0, 1).map((lead) => <div className="scenario-row" key={lead.id}><span className="scenario-icon">⇄</span><div><strong>Two reps claim at once</strong><small>Only one rep gets the lead</small></div><button disabled={!!busy} onClick={() => apiAction(`race-side-${lead.id}`, "/api/demo/scenarios", { scenario: "competing_claim", brandId: brand.id, leadId: lead.id })}>Try</button></div>)}
            {brand?.leads.filter((lead) => lead.status === "claimed").slice(0, 1).map((lead) => <div className="scenario-row" key={lead.id}><span className="scenario-icon">$</span><div><strong>Simulate recovered sale</strong><small>Record one fake order</small></div><button disabled={!!busy} onClick={() => apiAction(`sale-side-${lead.id}`, "/api/demo/scenarios", { scenario: "record_sale", brandId: brand.id, leadId: lead.id })}>Try</button></div>)}
            {brand?.leads.filter((lead) => lead.status === "recovered").slice(0, 1).map((lead) => <div className="scenario-row" key={lead.id}><span className="scenario-icon">↻</span><div><strong>Repeat a sale event</strong><small>Revenue is counted once</small></div><button disabled={!!busy} onClick={() => apiAction(`repeat-side-${lead.id}`, "/api/demo/scenarios", { scenario: "repeat_sale", brandId: brand.id, leadId: lead.id })}>Try</button></div>)}
            <div className="scenario-note"><span>↗</span><p>Suppressed leads cannot be claimed or receive a simulated sale.</p></div>
          </article>
          <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">LATEST UPDATES</p><h2>Activity</h2></div><span className="activity-dot" /></div>
            {brand?.activity.length ? <ol className="activity-list">{brand.activity.slice(0, 8).map((item) => <li key={item.id}><span className="activity-marker" /><div><p>{item.summary}</p><time>{new Date(item.created_at).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })} UTC</time></div></li>)}</ol>
              : <p className="activity-empty">Your demo actions will show up here.</p>}
          </article>
        </aside>
      </section>
      <footer className="page-footer"><span>Built as an independent backend engineering demo.</span><span>Every brand, rep, cart and revenue figure is fictional.</span></footer>
    </main>
  );
}

function Topbar({ onRestart, busy }: { onRestart: () => void; busy: string }) {
  return <header className="topbar"><a className="wordmark" href="#home" aria-label="Recoverly home"><span className="wordmark-mark">R</span><span>recoverly</span></a>
    <div className="topbar-right"><span className="demo-label">Independent demo · Fake data · Simulated revenue</span><button className="restart-button" onClick={onRestart} disabled={!!busy}>Start again <span aria-hidden="true">↻</span></button></div></header>;
}

function SetupCard() {
  return <section className="panel setup-card"><h2>One small setup step</h2><p>The app needs the local database URL, server key and fake-event signing secret. The included <code>.env.example</code> shows the names; keep the real values on the server.</p></section>;
}
