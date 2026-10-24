import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";

const LOCAL_REQUESTS_KEY = "payapp.preview.requests";

function loadLocalRequests() {
  const saved = localStorage.getItem(LOCAL_REQUESTS_KEY);
  if (!saved) return [];

  const requests = JSON.parse(saved);
  if (
    !Array.isArray(requests) ||
    requests.some((request) =>
      !request ||
      typeof request.id !== "string" ||
      typeof request.description !== "string" ||
      typeof request.amount !== "string" ||
      !/^\d{1,4}\.\d{2}$/.test(request.amount) ||
      request.currency !== "USD" ||
      request.status !== "draft" ||
      typeof request.createdAt !== "string"
    )
  ) {
    throw new Error("Saved drafts could not be read. Clear local preview data and try again.");
  }
  return requests;
}

function formatAmount(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function Header() {
  return (
    <nav className="navbar navbar-expand-lg app-navbar">
      <div className="container">
        <Link className="navbar-brand app-brand" to="/">pay<span>app</span></Link>
        <div className="d-flex align-items-center gap-3 ms-auto">
          <Link className="btn btn-app-outline btn-sm" to="/dashboard">My PayApp</Link>
          <div className="dropdown">
            <button className="account-avatar dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Open account menu">G</button>
            <ul className="dropdown-menu dropdown-menu-end account-menu">
              <li><span className="dropdown-item-text small text-secondary">Local preview</span></li>
              <li><hr className="dropdown-divider" /></li>
              <li><button className="dropdown-item" type="button" onClick={() => {
                localStorage.removeItem(LOCAL_REQUESTS_KEY);
                window.location.reload();
              }}>Clear saved drafts</button></li>
            </ul>
          </div>
        </div>
      </div>
    </nav>
  );
}

function RequestForm({ onCreated }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount < 0.01 || numericAmount > 5000) {
        throw new Error("Enter an amount from $0.01 to $5,000.");
      }
      const request = {
        id: crypto.randomUUID(),
        description: description.trim(),
        amount: numericAmount.toFixed(2),
        currency: "USD",
        status: "draft",
        createdAt: new Date().toISOString()
      };
      const requests = loadLocalRequests();
      localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify([request, ...requests]));
      setDescription("");
      setAmount("");
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card app-card mb-4">
      <div className="card-body p-4">
        <div className="d-flex flex-wrap align-items-start justify-content-between gap-3 mb-3">
          <div>
            <span className="eyebrow">REQUEST DRAFT</span>
            <h2 className="h5 fw-bold mt-1 mb-1">New request</h2>
            <p className="text-secondary small mb-0">Save a draft on this device.</p>
          </div>
          <span className="sandbox-badge">LOCAL DRAFT</span>
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="border-0 p-0 m-0">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md">
              <label className="form-label" htmlFor="description">What is this payment for?</label>
              <input id="description" className="form-control" value={description} onChange={(event) => setDescription(event.target.value)} maxLength="100" required placeholder="e.g. Community garden supplies" />
            </div>
            <div className="col-12 col-sm-5 col-md-3">
              <label className="form-label" htmlFor="amount">Amount (USD)</label>
              <div className="input-group">
                <span className="input-group-text">$</span>
                <input id="amount" className="form-control" type="number" min="0.01" max="5000" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0.00" />
              </div>
            </div>
            <div className="col-12 col-sm-auto">
              <button className="btn btn-primary w-100" type="submit">{busy ? "Saving…" : "Save draft"}</button>
            </div>
          </div>
          </fieldset>
          {error && <div className="alert alert-danger mt-3 mb-0 py-2" role="alert">{error}</div>}
        </form>
      </div>
    </section>
  );
}

function PaymentList({ requests, onCreate }) {
  if (!requests.length) {
    return (
      <div className="empty-state text-center px-3 py-5">
        <div className="empty-icon mx-auto mb-3" aria-hidden="true">↗</div>
        <h3 className="h6 fw-bold">No activity yet</h3>
        <p className="text-secondary small mb-3">Saved requests will appear here as drafts.</p>
        {onCreate && <button className="btn btn-app-outline btn-sm" type="button" onClick={onCreate}>Create a request</button>}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table align-middle mb-0">
        <thead><tr><th scope="col">Request</th><th scope="col">Created</th><th scope="col">Status</th><th scope="col" className="text-end">Amount</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td><div className="fw-semibold">{request.description}</div><div className="text-secondary small">Saved on this device</div></td>
              <td className="text-secondary small">{new Date(request.createdAt).toLocaleDateString()}</td>
              <td><span className="badge rounded-pill text-bg-secondary">Draft · not paid</span></td>
              <td className="text-end fw-semibold text-nowrap">{formatAmount(request.amount, request.currency)}</td>
              <td className="text-end">{request.paymentUrl && <button className="btn btn-sm btn-outline-primary text-nowrap" type="button" onClick={() => onCopy(request.paymentUrl)}>Copy link</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dashboardTabs = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "balance", label: "Balance", icon: "◉" },
  { id: "activity", label: "Activity", icon: "↻" },
  { id: "request", label: "Request", icon: "＋" },
  { id: "help", label: "Help", icon: "?" }
];

function DashboardNavigation({ currentTab, onSelect }) {
  return (
    <>
      <nav className="dashboard-tabs" aria-label="Account sections" role="tablist">
        {dashboardTabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            className={`dashboard-tab${currentTab === tab.id ? " active" : ""}`}
            type="button"
            role="tab"
            aria-selected={currentTab === tab.id}
            aria-controls="dashboard-panel"
            onKeyDown={(event) => {
              let nextIndex = index;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % dashboardTabs.length;
              else if (event.key === "ArrowLeft") nextIndex = (index - 1 + dashboardTabs.length) % dashboardTabs.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End") nextIndex = dashboardTabs.length - 1;
              else return;
              event.preventDefault();
              const nextTab = dashboardTabs[nextIndex];
              document.getElementById(`tab-${nextTab.id}`)?.focus();
              onSelect(nextTab.id);
            }}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
      <nav className="mobile-bottom-nav" aria-label="Account sections">
        {dashboardTabs.map((tab) => (
          <button
            key={tab.id}
            className={`mobile-tab${currentTab === tab.id ? " active" : ""}`}
            type="button"
            aria-current={currentTab === tab.id ? "page" : undefined}
            onClick={() => onSelect(tab.id)}
          >
            <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

function DashboardOverview({ requests, summary, onSelect }) {
  return (
    <>
      <div className="page-heading d-flex flex-wrap justify-content-between align-items-end gap-3">
        <div>
          <span className="eyebrow">PAYAPP</span>
          <h1 className="display-6 fw-bold mt-1 mb-1">Your drafts, at a glance.</h1>
        </div>
        <button className="btn btn-app-primary" type="button" onClick={() => onSelect("request")}>＋ New request</button>
      </div>
      <div className="row g-3 mb-4">
        <div className="col-12 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("balance")}>
            <span className="summary-label">Confirmed</span>
            <strong>{formatAmount(summary.confirmedCents / 100)}</strong>
            <span className="summary-detail">Payments are off</span>
          </button>
        </div>
        <div className="col-6 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("activity")}>
            <span className="summary-label">Paid</span>
            <strong>{summary.paidRequests}</strong>
            <span className="summary-detail">not available in preview</span>
          </button>
        </div>
        <div className="col-6 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("activity")}>
            <span className="summary-label">Drafts</span>
            <strong>{summary.pendingRequests}</strong>
            <span className="summary-detail">not sent or paid</span>
          </button>
        </div>
      </div>
      <section className="card app-card">
        <div className="list-heading d-flex align-items-center justify-content-between gap-3 px-4 py-3">
          <h2 className="h6 fw-bold mb-0">Recent drafts</h2>
          <button className="btn btn-app-outline btn-sm" type="button" onClick={() => onSelect("activity")}>See all</button>
        </div>
        <PaymentList requests={requests.slice(0, 5)} onCreate={() => onSelect("request")} />
      </section>
    </>
  );
}

function BalancePanel({ summary, onSelect }) {
  return (
    <section className="balance-panel card app-card">
      <div className="card-body p-4 p-md-5">
        <span className="eyebrow">BALANCE</span>
        <h1 className="h3 fw-bold mt-2">PayPal balance</h1>
        <p className="balance-unavailable">Your PayPal wallet balance isn’t connected to PayApp.</p>
        <hr className="my-4" />
        <div className="d-flex flex-wrap align-items-end justify-content-between gap-3">
          <div>
            <div className="summary-label">Confirmed through PayApp</div>
            <div className="confirmed-total">{formatAmount(summary.confirmedCents / 100)}</div>
            <div className="summary-detail">No payments in preview</div>
          </div>
          <button className="btn btn-app-outline" type="button" onClick={() => onSelect("activity")}>View activity</button>
        </div>
      </div>
    </section>
  );
}

function HelpPanel({ onSelect }) {
  return (
    <section className="card app-card">
      <div className="card-body p-4 p-md-5">
        <span className="eyebrow">HELP</span>
        <h1 className="h3 fw-bold mt-2">Quick answers</h1>
        <div className="help-item">
          <h2>Where’s my balance?</h2>
          <p>Your PayPal wallet isn’t connected. This preview only saves drafts.</p>
        </div>
        <div className="help-item">
          <h2>Can I send a payment?</h2>
          <p>Sending and checkout are turned off in this preview.</p>
        </div>
        <div className="help-item">
          <h2>Can I share a draft?</h2>
          <p>Payments are turned off. Saved requests are local drafts only.</p>
        </div>
        <button className="btn btn-app-primary mt-2" type="button" onClick={() => onSelect("request")}>Create a request</button>
      </div>
    </section>
  );
}

function LandingPage() {
  return (
    <main className="landing-page">
      <section className="container landing-hero">
        <div className="row align-items-center g-5">
          <div className="col-lg-7">
            <h1 className="landing-title">Keep your plans<br className="d-none d-md-block" /> moving <span>simply.</span></h1>
            <p className="landing-copy">Make a draft. Keep it in one place.</p>
            <div className="d-flex flex-wrap gap-3 mt-4">
              <Link className="btn btn-app-primary btn-lg" to="/dashboard">Get started <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="landing-footnote">Local preview · No payments</p>
          </div>
          <div className="col-lg-5">
            <div className="landing-visual" aria-label="Illustration showing a payment request draft saved on this device">
              <div className="visual-orbit orbit-one" />
              <div className="visual-orbit orbit-two" />
              <div className="visual-spark spark-one" aria-hidden="true">✳</div>
              <div className="visual-spark spark-two" aria-hidden="true">✦</div>
              <div className="visual-card">
                <div className="d-flex align-items-center justify-content-between mb-4">
                  <span className="visual-brand">pay<span>app</span></span>
                  <span className="visual-label">LOCAL DRAFT</span>
                </div>
                <p className="visual-caption">Your money notes</p>
                <h2 className="visual-heading">A little more<br />organized.</h2>
                <div className="visual-divider" />
                <div className="d-flex align-items-center gap-2">
                  <span className="visual-link-icon" aria-hidden="true">↗</span>
                  <span className="visual-share-text">Saved right on this device</span>
                </div>
                <div className="visual-secure">PRIVATE TO THIS BROWSER <span aria-hidden="true">✓</span></div>
              </div>
              <div className="visual-floating" aria-hidden="true"><span>✓</span> Saved locally</div>
            </div>
          </div>
        </div>
      </section>

      <section className="container landing-how" id="how-it-works">
        <div className="landing-section-heading">
          <span className="landing-kicker">STRAIGHTFORWARD BY DESIGN</span>
          <h2>Simple by design.</h2>
        </div>
        <div className="row g-3">
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">01</span>
              <h3>Add a draft</h3>
              <p>Give it a name and amount.</p>
            </article>
          </div>
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">02</span>
              <h3>Stay organized</h3>
              <p>See saved drafts in one place.</p>
            </article>
          </div>
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">03</span>
              <h3>You're in control</h3>
              <p>Your drafts stay on this device.</p>
            </article>
          </div>
        </div>
        <div className="landing-note mt-4"><span aria-hidden="true">✳</span><span>Local preview. Sending and checkout are off.</span></div>
      </section>
    </main>
  );
}

function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [storageError, setStorageError] = useState("");
  const summary = {
    totalRequests: requests.length,
    paidRequests: requests.filter((request) => request.status === "paid").length,
    pendingRequests: requests.filter((request) => request.status === "draft").length,
    confirmedCents: requests
      .filter((request) => request.status === "paid")
      .reduce((total, request) => total + Math.round(Number(request.amount) * 100), 0)
  };
  const requestedTab = searchParams.get("tab");
  const currentTab = dashboardTabs.some((tab) => tab.id === requestedTab) ? requestedTab : "overview";

  function selectTab(tab) {
    setSearchParams(tab === "overview" ? {} : { tab }, { replace: true });
  }

  function refresh() {
    try {
      setRequests(loadLocalRequests());
      setStorageError("");
    } catch (err) {
      setStorageError(err instanceof SyntaxError ? "Saved drafts are damaged. Clear local preview data to continue." : err.message);
    }
  }

  useEffect(() => {
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  return (
    <main className="container app-main dashboard-main">
      <DashboardNavigation currentTab={currentTab} onSelect={selectTab} />
      <div className="alert alert-warning py-2 small" role="status">Preview · drafts stay on this device · payments are off</div>
      <div
        className="dashboard-panel"
        id="dashboard-panel"
        role="tabpanel"
        aria-labelledby={`tab-${currentTab}`}
        aria-busy="false"
      >
        {storageError
          ? <div className="card app-card p-4"><h1 className="h5 fw-bold">Couldn’t open saved drafts</h1><p className="text-secondary mb-3">{storageError}</p><button className="btn btn-app-primary align-self-start" type="button" onClick={() => { localStorage.removeItem(LOCAL_REQUESTS_KEY); refresh(); }}>Clear local data</button></div>
          : currentTab === "overview"
            ? <DashboardOverview requests={requests} summary={summary} onSelect={selectTab} />
            : currentTab === "balance"
              ? <BalancePanel summary={summary} onSelect={selectTab} />
              : currentTab === "activity"
                ? (
                  <section className="card app-card">
                    <div className="list-heading d-flex align-items-center justify-content-between gap-3 px-4 py-3">
                      <div><h1 className="h5 fw-bold mb-1">Activity</h1><p className="text-secondary small mb-0">{summary.totalRequests} local drafts</p></div>
                      <button className="btn btn-app-outline btn-sm" type="button" onClick={refresh}>Refresh</button>
                    </div>
                    <PaymentList requests={requests} onCreate={() => selectTab("request")} />
                  </section>
                )
                : currentTab === "request"
                  ? (
                    <>
                      <RequestForm onCreated={refresh} />
                      <section className="card app-card">
                        <div className="list-heading px-4 py-3"><h2 className="h6 fw-bold mb-0">Latest links</h2></div>
                        <PaymentList requests={requests} />
                      </section>
                    </>
                  )
                  : <HelpPanel onSelect={selectTab} />}
      </div>
    </main>
  );
}

function PaymentPage() {
  const { publicId } = useParams();
  return (
    <main className="container narrow-main">
      <div className="text-center mb-4"><Link to="/" className="navbar-brand app-brand">pay<span>app</span></Link></div>
      <section className="card app-card checkout-card">
        <div className="card-body p-4 p-md-5">
          <span className="eyebrow">PREVIEW</span>
          <h1 className="h4 fw-bold mt-2 mb-1">Payments are paused</h1>
          <p className="text-secondary mt-3 mb-3">This local preview doesn’t create payable links or process transactions.</p>
          <p className="small text-secondary mb-4">Request ID: <code>{publicId}</code></p>
          <Link to="/dashboard?tab=request" className="btn btn-app-primary">Back to dashboard</Link>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <Routes>
        <Route path="/pay/:publicId" element={<PaymentPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      
    </>
  );
}
