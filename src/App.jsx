import { useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "firebase/auth";
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { apiRequest } from "./api.js";
import { auth, firebaseConfigured } from "./firebase.js";
import { getSessionToken, signOutSession, subscribeToSession } from "./session.js";

function formatAmount(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function FirebaseSetupNotice() {
  return (
    <div className="alert alert-warning mb-0" role="alert">
      <strong>Firebase setup needed.</strong> Create <code>.env.local</code> with your Firebase web-app settings.
      Enable Email/Password sign-in in Firebase Authentication before creating
      an account.
    </div>
  );
}

function Header({ user, authMode }) {
  const initials = (user?.email || "A")
    .split("@")[0]
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <nav className="navbar navbar-expand-lg app-navbar">
      <div className="container">
        <Link className="navbar-brand app-brand" to="/">pay<span>app</span></Link>
        <div className="d-flex align-items-center gap-3 ms-auto">
          <Link className="btn btn-app-outline btn-sm" to="/dashboard">My PayApp</Link>
          {user ? (
            <div className="dropdown">
              <button
                className="account-avatar dropdown-toggle"
                type="button"
                data-bs-toggle="dropdown"
                aria-expanded="false"
                aria-label="Open account menu"
              >
                {initials || "A"}
              </button>
              <ul className="dropdown-menu dropdown-menu-end account-menu">
                <li><span className="dropdown-item-text small text-secondary">{user.email}</span></li>
                {user.isLocalDevelopment && <li><span className="dropdown-item-text"><span className="sandbox-badge">LOCAL SESSION</span></span></li>}
                <li><hr className="dropdown-divider" /></li>
                <li><button className="dropdown-item" type="button" onClick={() => signOutSession(authMode)}>{authMode === "firebase" ? "Sign out" : "New local session"}</button></li>
              </ul>
            </div>
          ) : <Link className="btn btn-app-primary btn-sm" to="/dashboard">Sign in</Link>}
        </div>
      </div>
    </nav>
  );
}

function AuthPanel() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(err.message || "Authentication failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card app-card auth-card">
      <div className="card-body p-4 p-md-5">
        <span className="eyebrow">PAYMENT REQUESTS, MADE CLEAR</span>
        <h1 className="h3 fw-bold mt-2">Your payments, in one place.</h1>
        <p className="text-secondary mb-4">Sign in to create secure PayPal Sandbox payment links and track confirmed payments.</p>
        {!firebaseConfigured ? <FirebaseSetupNotice /> : (
          <>
            <div className="btn-group w-100 mb-4" role="group" aria-label="Account options">
              <button type="button" className={`btn ${mode === "signin" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
              <button type="button" className={`btn ${mode === "signup" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
            </div>
            <form onSubmit={submit}>
              <div className="mb-3">
                <label className="form-label" htmlFor="email">Email</label>
                <input id="email" type="email" className="form-control" autoComplete="email" required maxLength="254" value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label" htmlFor="password">Password</label>
                <input id="password" type="password" className="form-control" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength="8" required value={password} onChange={(event) => setPassword(event.target.value)} />
                <div className="form-text">Use at least 8 characters.</div>
              </div>
              {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
              <button className="btn btn-primary w-100 py-2" type="submit" disabled={busy}>
                {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function RequestForm({ onCreated, enabled, user }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const token = await getSessionToken(user);
      await apiRequest("/api/requests", {
        method: "POST",
        token,
        body: JSON.stringify({ description, amount })
      });
      setDescription("");
      setAmount("");
      await onCreated();
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
            <span className="eyebrow">NEW PAYMENT LINK</span>
            <h2 className="h5 fw-bold mt-1 mb-1">Request a payment</h2>
            <p className="text-secondary small mb-0">Create a link you can share. Amount and description are locked in at checkout.</p>
          </div>
          <span className="sandbox-badge">SANDBOX ONLY</span>
        </div>
        <form onSubmit={submit}>
          {!enabled && <p className="small text-warning-emphasis mb-3">Add PayPal Sandbox credentials to the server configuration before creating payment links.</p>}
          <fieldset disabled={!enabled || busy} className="border-0 p-0 m-0">
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
              <button className="btn btn-primary w-100" type="submit">{busy ? "Creating…" : "Create payment link"}</button>
            </div>
          </div>
          </fieldset>
          {error && <div className="alert alert-danger mt-3 mb-0 py-2" role="alert">{error}</div>}
        </form>
      </div>
    </section>
  );
}

function PaymentList({ requests, onCopy, onCreate }) {
  if (!requests.length) {
    return (
      <div className="empty-state text-center px-3 py-5">
        <div className="empty-icon mx-auto mb-3" aria-hidden="true">↗</div>
        <h3 className="h6 fw-bold">No activity yet</h3>
        <p className="text-secondary small mb-3">New payments will appear here.</p>
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
              <td><div className="fw-semibold">{request.description}</div><div className="text-secondary small">PayPal Sandbox</div></td>
              <td className="text-secondary small">{new Date(request.createdAt).toLocaleDateString()}</td>
              <td><span className={`badge rounded-pill ${request.status === "paid" ? "text-bg-success" : "text-bg-secondary"}`}>{request.status === "paid" ? "Paid" : "Awaiting payment"}</span>{request.payerName && <div className="text-secondary small mt-1">Paid by {request.payerName}</div>}</td>
              <td className="text-end fw-semibold text-nowrap">{formatAmount(request.amount, request.currency)}</td>
              <td className="text-end">
                {request.status === "pending" && <button className="btn btn-sm btn-outline-primary text-nowrap" type="button" onClick={() => onCopy(request.paymentUrl)}>Copy link</button>}
                {request.status === "paid" && <span className="small text-secondary">Confirmed</span>}
              </td>
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

function DashboardOverview({ requests, summary, onSelect, onCopy }) {
  return (
    <>
      <div className="page-heading d-flex flex-wrap justify-content-between align-items-end gap-3">
        <div>
          <span className="eyebrow">PAYAPP</span>
          <h1 className="display-6 fw-bold mt-1 mb-1">Your money, at a glance.</h1>
        </div>
        <button className="btn btn-app-primary" type="button" onClick={() => onSelect("request")}>＋ New request</button>
      </div>
      <div className="row g-3 mb-4">
        <div className="col-12 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("balance")}>
            <span className="summary-label">PayApp confirmed</span>
            <strong>{formatAmount(summary.confirmedCents / 100)}</strong>
            <span className="summary-detail">Sandbox payments only</span>
          </button>
        </div>
        <div className="col-6 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("activity")}>
            <span className="summary-label">Paid</span>
            <strong>{summary.paidRequests}</strong>
            <span className="summary-detail">confirmed requests</span>
          </button>
        </div>
        <div className="col-6 col-md-4">
          <button className="summary-card w-100 text-start" type="button" onClick={() => onSelect("activity")}>
            <span className="summary-label">Awaiting payment</span>
            <strong>{summary.pendingRequests}</strong>
            <span className="summary-detail">open requests</span>
          </button>
        </div>
      </div>
      <section className="card app-card">
        <div className="list-heading d-flex align-items-center justify-content-between gap-3 px-4 py-3">
          <h2 className="h6 fw-bold mb-0">Recent activity</h2>
          <button className="btn btn-app-outline btn-sm" type="button" onClick={() => onSelect("activity")}>See all</button>
        </div>
        <PaymentList requests={requests.slice(0, 5)} onCopy={onCopy} onCreate={() => onSelect("request")} />
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
            <div className="summary-detail">PayPal Sandbox checkouts · test funds</div>
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
          <p>PayApp doesn’t access PayPal wallet balances. This tab shows confirmed PayApp checkouts.</p>
        </div>
        <div className="help-item">
          <h2>Can I send money to another person?</h2>
          <p>Payment links go to the merchant configured for this app. Person-to-person transfers aren’t connected.</p>
        </div>
        <div className="help-item">
          <h2>Why is checkout in Sandbox?</h2>
          <p>Sandbox payments are tests. No real funds move.</p>
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
            <h1 className="landing-title">Good things happen<br className="d-none d-md-block" /> when money <span>moves simply.</span></h1>
            <p className="landing-copy">Request. Share. Get confirmation.</p>
            <div className="d-flex flex-wrap gap-3 mt-4">
              <Link className="btn btn-app-primary btn-lg" to="/dashboard">Get started <span aria-hidden="true">↗</span></Link>
            </div>
            <p className="landing-footnote">Sandbox payments · No real money</p>
          </div>
          <div className="col-lg-5">
            <div className="landing-visual" aria-label="Illustration showing a shareable payment request">
              <div className="visual-orbit orbit-one" />
              <div className="visual-orbit orbit-two" />
              <div className="visual-spark spark-one" aria-hidden="true">✳</div>
              <div className="visual-spark spark-two" aria-hidden="true">✦</div>
              <div className="visual-card">
                <div className="d-flex align-items-center justify-content-between mb-4">
                  <span className="visual-brand">pay<span>app</span></span>
                  <span className="visual-label">PAYMENT LINK</span>
                </div>
                <p className="visual-caption">Payment request</p>
                <h2 className="visual-heading">Clear.<br />Simple.</h2>
                <div className="visual-divider" />
                <div className="d-flex align-items-center gap-2">
                  <span className="visual-link-icon" aria-hidden="true">↗</span>
                  <span className="visual-share-text">One link. Ready to share.</span>
                </div>
                <div className="visual-secure" aria-label="PayPal Sandbox checkout">PAYPAL SANDBOX CHECKOUT <span aria-hidden="true">✓</span></div>
              </div>
              <div className="visual-floating" aria-hidden="true"><span>↗</span> Ready to share</div>
            </div>
          </div>
        </div>
      </section>

      <section className="container landing-how" id="how-it-works">
        <div className="landing-section-heading">
          <span className="landing-kicker">STRAIGHTFORWARD BY DESIGN</span>
          <h2>Three simple steps.</h2>
        </div>
        <div className="row g-3">
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">01</span>
              <h3>Make a request</h3>
              <p>Add a note and amount.</p>
            </article>
          </div>
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">02</span>
              <h3>Share one simple link</h3>
              <p>Share your payment link.</p>
            </article>
          </div>
          <div className="col-md-4">
            <article className="how-card h-100">
              <span className="how-number">03</span>
              <h3>Track the confirmation</h3>
              <p>See confirmation in your activity.</p>
            </article>
          </div>
        </div>
        <div className="landing-note mt-4"><span aria-hidden="true">✳</span><span>Sandbox only. No real money.</span></div>
      </section>
    </main>
  );
}

function Dashboard({ user, paypalConfigured }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestedTab = searchParams.get("tab");
  const currentTab = dashboardTabs.some((tab) => tab.id === requestedTab) ? requestedTab : "overview";

  function selectTab(tab) {
    setSearchParams(tab === "overview" ? {} : { tab }, { replace: true });
  }

  async function refresh() {
    if (!user) return;
    setError("");
    try {
      const token = await getSessionToken(user);
      const result = await apiRequest("/api/me/requests", { token });
      setRequests(result.requests);
      setSummary(result.summary);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [user]);

  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Payment link copied. Share it with the person who will pay.");
    } catch {
      setNotice(`Copy this payment link: ${url}`);
    }
    window.setTimeout(() => setNotice(""), 6000);
  }

  if (!user) return <AuthPanel />;

  return (
    <main className="container app-main dashboard-main">
      <DashboardNavigation currentTab={currentTab} onSelect={selectTab} />
      {notice && <div className="alert alert-success d-flex justify-content-between align-items-center gap-3 py-2" role="status"><span>{notice}</span><button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setNotice("")} /></div>}
      {!paypalConfigured && currentTab === "request" && <div className="alert alert-warning py-2 small" role="status">Sandbox checkout isn’t set up yet.</div>}
      <div
        className="dashboard-panel"
        id="dashboard-panel"
        role="tabpanel"
        aria-labelledby={`tab-${currentTab}`}
        aria-busy={loading}
      >
        {loading
          ? <div className="card app-card p-5 text-center text-secondary">Loading…</div>
          : error
            ? <div className="card app-card p-4"><h1 className="h5 fw-bold">Couldn’t load your data</h1><p className="text-secondary mb-3">{error}</p><button className="btn btn-app-primary align-self-start" type="button" onClick={() => { setLoading(true); refresh(); }}>Try again</button></div>
            : !summary
              ? <div className="card app-card p-5 text-center text-secondary">No account summary available.</div>
          : currentTab === "overview"
            ? <DashboardOverview requests={requests} summary={summary} onSelect={selectTab} onCopy={copyLink} />
            : currentTab === "balance"
              ? <BalancePanel summary={summary} onSelect={selectTab} />
              : currentTab === "activity"
                ? (
                  <section className="card app-card">
                    <div className="list-heading d-flex align-items-center justify-content-between gap-3 px-4 py-3">
                      <div><h1 className="h5 fw-bold mb-1">Activity</h1><p className="text-secondary small mb-0">Latest {requests.length} of {summary.totalRequests}</p></div>
                      <button className="btn btn-app-outline btn-sm" type="button" onClick={() => { setLoading(true); refresh(); }}>Refresh</button>
                    </div>
                    <PaymentList requests={requests} onCopy={copyLink} />
                  </section>
                )
                : currentTab === "request"
                  ? (
                    <>
                      <RequestForm onCreated={refresh} enabled={paypalConfigured} user={user} />
                      <section className="card app-card">
                        <div className="list-heading px-4 py-3"><h2 className="h6 fw-bold mb-0">Latest links</h2></div>
                        <PaymentList requests={requests} onCopy={copyLink} />
                      </section>
                    </>
                  )
                  : <HelpPanel onSelect={selectTab} />}
      </div>
    </main>
  );
}

function PaymentPage({ paypalClientId, paypalConfigured }) {
  const { publicId } = useParams();
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiRequest(`/api/requests/${encodeURIComponent(publicId)}`)
      .then((result) => {
        if (!cancelled) setRequest(result.request);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [publicId]);

  if (loading) return <main className="container narrow-main"><div className="card app-card p-5 text-center text-secondary">Loading payment request…</div></main>;
  if (error) return <main className="container narrow-main"><div className="alert alert-danger" role="alert">{error}</div><Link to="/" className="btn btn-outline-primary">Go to PayApp</Link></main>;

  async function createOrder() {
    const result = await apiRequest("/api/checkout/orders", {
      method: "POST",
      body: JSON.stringify({ paymentRequestId: publicId })
    });
    return result.orderId;
  }

  async function capturePayment(data) {
    const result = await apiRequest("/api/checkout/capture", {
      method: "POST",
      body: JSON.stringify({ paymentRequestId: publicId, orderId: data.orderID })
    });
    setRequest(result.request);
  }

  return (
    <main className="container narrow-main">
      <div className="text-center mb-4"><Link to="/" className="navbar-brand app-brand">pay<span>app</span></Link></div>
      <section className="card app-card checkout-card">
        <div className="card-body p-4 p-md-5">
          <span className="eyebrow">PAYMENT REQUEST</span>
          <h1 className="h4 fw-bold mt-2 mb-1">{request.description}</h1>
          <div className="checkout-amount my-4">{formatAmount(request.amount, request.currency)}</div>
          <div className="d-flex justify-content-between align-items-center border-top border-bottom py-3 mb-4 small">
            <span className="text-secondary">Payment status</span>
            <span className={`badge rounded-pill ${request.status === "paid" ? "text-bg-success" : "text-bg-secondary"}`}>{request.status === "paid" ? "Paid" : "Awaiting payment"}</span>
          </div>
          {request.status === "paid" ? (
            <div className="alert alert-success mb-0" role="status">
              <strong>Payment confirmed.</strong> PayApp verified this payment with PayPal Sandbox.
            </div>
          ) : !paypalConfigured || !paypalClientId ? (
            <div className="alert alert-warning mb-0" role="alert">PayPal Sandbox checkout is not configured for this app yet.</div>
          ) : (
            <>
              <p className="small text-secondary">You’ll check out with PayPal Sandbox. No real money will be charged.</p>
              {error && <div className="alert alert-danger" role="alert">{error}</div>}
              <PayPalScriptProvider options={{ "client-id": paypalClientId, currency: "USD", intent: "capture", components: "buttons" }}>
                <PayPalButtons
                  style={{ layout: "vertical", shape: "rect", label: "paypal" }}
                  createOrder={async () => {
                    try {
                      setError("");
                      return await createOrder();
                    } catch (err) {
                      setError(err.message);
                      throw err;
                    }
                  }}
                  onApprove={async (data, actions) => {
                    try {
                      setError("");
                      await capturePayment(data);
                    } catch (err) {
                      setError(err.message);
                      await actions.restart();
                    }
                  }}
                  onError={(err) => setError(err?.message || "PayPal Sandbox checkout failed. Please try again.")}
                />
              </PayPalScriptProvider>
            </>
          )}
          <p className="small text-center text-secondary mt-4 mb-0">Test payment processed through PayPal Sandbox · PayApp does not see your PayPal password.</p>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState(null);
  const [authError, setAuthError] = useState("");
  const [paypalConfig, setPaypalConfig] = useState({ loaded: false, configured: false, clientId: null });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe;
    apiRequest("/api/config")
      .then((config) => {
        if (cancelled) return;
        setAuthMode(config.authMode);
        setPaypalConfig({
          loaded: true,
          configured: config.paypalSandboxConfigured,
          clientId: config.paypalClientId
        });

        if (config.authMode === "firebase" && !firebaseConfigured) {
          setAuthError("This server uses Firebase Authentication. Add its Firebase web-app settings to .env.local and reload.");
          setAuthReady(true);
          return;
        }

        unsubscribe = subscribeToSession(
          (currentUser) => {
            if (!cancelled) {
              setUser(currentUser);
              setAuthReady(true);
            }
          },
          (error) => {
            if (!cancelled) {
              setAuthError(error.message || "Unable to start a local session. Check that the PayApp server is running.");
              setAuthReady(true);
            }
          },
          config.authMode === "firebase"
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthError(error.message || "Cannot connect to the PayApp server.");
          setAuthReady(true);
        }
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return (
    <>
      <Header user={user} authMode={authMode} />
      <Routes>
        <Route path="/pay/:publicId" element={<PaymentPage paypalClientId={paypalConfig.clientId} paypalConfigured={paypalConfig.configured} />} />
        <Route path="/dashboard" element={
          !authReady
            ? <main className="container app-main"><div className="card app-card p-5 text-center text-secondary">Connecting to PayApp…</div></main>
            : authError
              ? <main className="container app-main"><div className="alert alert-warning" role="alert"><h1 className="h5">Your dashboard is temporarily unavailable.</h1><p>{authError}</p><p className="mb-3">You can still explore the landing page while the server starts. Payment requests need the PayApp API and MongoDB to be running.</p><Link className="btn btn-app-primary" to="/">Go to home</Link></div></main>
              : authMode === "firebase" && !user
                ? <AuthPanel />
                : <Dashboard user={user} paypalConfigured={paypalConfig.configured} />
        } />
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      
    </>
  );
}
