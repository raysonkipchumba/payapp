import "dotenv/config";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import { z } from "zod";
import { PaymentRequest } from "./models/PaymentRequest.js";
import { captureOrder, createOrder, HttpError, paypalIsConfigured, validateCompletedCapture } from "./paypal.js";

const app = express();
const port = Number(process.env.PORT || 3001);
const appBaseUrl = new URL(process.env.APP_BASE_URL || "http://localhost:5173");
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const authMode = firebaseProjectId ? "firebase" : "local-development";
const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN ||
  (firebaseProjectId ? `${firebaseProjectId}.firebaseapp.com` : null);
if (!["http:", "https:"].includes(appBaseUrl.protocol)) {
  throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
}
if (process.env.NODE_ENV === "production" && authMode !== "firebase") {
  throw new Error("FIREBASE_PROJECT_ID is required in production. Local development sessions are not allowed.");
}
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (process.env.NODE_ENV === "production" && !process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required in production.");
}

if (authMode === "firebase") {
  initializeApp({ projectId: firebaseProjectId });
}
async function getLocalSessionSecret() {
  if (process.env.DEV_AUTH_SECRET) return process.env.DEV_AUTH_SECRET;

  const secretFile = fileURLToPath(new URL("../.payapp-dev-auth-secret", import.meta.url));
  try {
    return (await readFile(secretFile, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const generatedSecret = randomBytes(32).toString("hex");
  try {
    await writeFile(secretFile, generatedSecret, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return generatedSecret;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return (await readFile(secretFile, "utf8")).trim();
  }
}

const localSessionSecret = authMode === "local-development" ? await getLocalSessionSecret() : null;
const LOCAL_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://www.sandbox.paypal.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://www.paypalobjects.com"],
        connectSrc: [
          "'self'",
          "https://api-m.sandbox.paypal.com",
          "https://www.sandbox.paypal.com",
          ...(firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : []),
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://www.googleapis.com"
        ],
        frameSrc: [
          "https://www.sandbox.paypal.com",
          "https://*.sandbox.paypal.com",
          ...(firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : [])
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: null
      }
    }
  })
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new HttpError(403, "This origin is not allowed."));
    }
  })
);
app.use(express.json({ limit: "16kb", strict: true }));

const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const checkoutLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const accountLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
const devSessionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const requestSchema = z.object({
  description: z.string().trim().min(1).max(100),
  amount: z.string()
    .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,2})?$/)
    .transform(Number)
    .pipe(z.number().finite().min(0.01).max(5000))
}).strict();
const publicIdSchema = z.string().uuid();
const orderCaptureSchema = z.object({
  paymentRequestId: publicIdSchema,
  orderId: z.string().regex(/^[A-Z0-9-]{10,40}$/i)
}).strict();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireDatabase(req, _res, next) {
  if (mongoose.connection.readyState !== 1) {
    next(new HttpError(503, "PayApp's database is not connected. Start MongoDB, then retry."));
    return;
  }
  next();
}

function signLocalSession(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", localSessionSecret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyLocalSession(token) {
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return null;
  const expected = createHmac("sha256", localSessionSecret).update(encodedPayload).digest();
  let provided;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      payload.iss !== "payapp-local-development" ||
      typeof payload.uid !== "string" ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

function asPublicRequest(request) {
  return {
    id: request.publicId,
    description: request.description,
    amount: (request.amountCents / 100).toFixed(2),
    currency: request.currency,
    status: request.status,
    createdAt: request.createdAt,
    paidAt: request.status === "paid" ? request.updatedAt : null
  };
}

function asOwnerRequest(request) {
  return {
    ...asPublicRequest(request),
    paymentUrl: new URL(`/pay/${request.publicId}`, appBaseUrl).toString(),
    payerName: request.payerName
  };
}

const requireSignedInUser = asyncRoute(async (req, _res, next) => {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in to view and create your payment requests.");
  }
  if (authMode === "local-development") {
    const session = verifyLocalSession(authorization.slice(7));
    if (!session) throw new HttpError(401, "Your local development session has expired. Refresh to continue.");
    req.firebaseUser = { uid: session.uid };
    req.isLocalDevelopmentUser = true;
    next();
    return;
  }
  try {
    req.firebaseUser = await getAuth().verifyIdToken(authorization.slice(7));
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again to continue.");
  }
  next();
});

app.get("/api/health", (_req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ok" : "unavailable",
    databaseReady,
    paypalSandboxConfigured: paypalIsConfigured()
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    authMode,
    paypalSandboxConfigured: paypalIsConfigured(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null
  });
});

app.post("/api/dev/session", devSessionLimiter, (_req, res, next) => {
  if (authMode !== "local-development") {
    next(new HttpError(404, "Local development sessions are disabled when Firebase Authentication is configured."));
    return;
  }
  const uid = `local_${randomUUID()}`;
  const expiresAt = Date.now() + LOCAL_SESSION_LIFETIME_SECONDS * 1000;
  const token = signLocalSession({
    uid,
    iss: "payapp-local-development",
    exp: Math.floor(expiresAt / 1000)
  });
  res.status(201).json({
    session: {
      uid,
      token,
      expiresAt,
      mode: "local-development"
    }
  });
});

app.get("/api/requests/:publicId", publicLimiter, requireDatabase, asyncRoute(async (req, res) => {
  const parsedId = publicIdSchema.safeParse(req.params.publicId);
  if (!parsedId.success) throw new HttpError(404, "This payment request could not be found.");

  const request = await PaymentRequest.findOne({ publicId: parsedId.data }).lean();
  if (!request) throw new HttpError(404, "This payment request could not be found.");
  res.json({ request: asPublicRequest(request), paypalSandboxConfigured: paypalIsConfigured() });
}));

app.get("/api/me/requests", accountLimiter, requireSignedInUser, requireDatabase, asyncRoute(async (req, res) => {
  const requests = await PaymentRequest.find({ ownerUid: req.firebaseUser.uid })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ requests: requests.map(asOwnerRequest), authMode });
}));

app.post("/api/requests", accountLimiter, requireSignedInUser, requireDatabase, asyncRoute(async (req, res) => {
  if (!paypalIsConfigured()) throw new HttpError(503, "PayPal Sandbox is not configured yet.");
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, "Enter a description (up to 100 characters) and an amount from $0.01 to $5,000.");
  }

  const request = await PaymentRequest.create({
    publicId: randomUUID(),
    ownerUid: req.firebaseUser.uid,
    description: parsed.data.description,
    amountCents: Math.round(parsed.data.amount * 100),
    currency: "USD"
  });
  res.status(201).json({ request: asOwnerRequest(request), authMode });
}));

app.post("/api/checkout/orders", checkoutLimiter, requireDatabase, asyncRoute(async (req, res) => {
  const parsed = z.object({ paymentRequestId: publicIdSchema }).strict().safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Provide a valid payment request.");
  if (!paypalIsConfigured()) throw new HttpError(503, "PayPal Sandbox is not configured yet.");

  const current = await PaymentRequest.findOne({ publicId: parsed.data.paymentRequestId });
  if (!current) throw new HttpError(404, "This payment request could not be found.");
  if (current.status !== "pending") throw new HttpError(409, "This payment request has already been paid.");
  if (current.orderId) return res.json({ orderId: current.orderId });

  const now = new Date();
  const locked = await PaymentRequest.findOneAndUpdate(
    {
      _id: current._id,
      status: "pending",
      orderId: null,
      $or: [{ checkoutLockUntil: null }, { checkoutLockUntil: { $lte: now } }]
    },
    { $set: { checkoutLockUntil: new Date(now.getTime() + 90_000) } },
    { new: true }
  );

  if (!locked) {
    const latest = await PaymentRequest.findById(current._id).lean();
    if (latest?.orderId) return res.json({ orderId: latest.orderId });
    throw new HttpError(409, "Checkout is being prepared. Please try again in a moment.");
  }

  try {
    const orderId = await createOrder(locked);
    const saved = await PaymentRequest.findOneAndUpdate(
      { _id: locked._id, status: "pending" },
      { $set: { orderId, checkoutLockUntil: null } },
      { new: true }
    );
    if (!saved) throw new HttpError(409, "This payment request is no longer available.");
    res.json({ orderId });
  } catch (error) {
    await PaymentRequest.updateOne(
      { _id: locked._id, orderId: null },
      { $set: { checkoutLockUntil: null } }
    );
    throw error;
  }
}));

app.post("/api/checkout/capture", checkoutLimiter, requireDatabase, asyncRoute(async (req, res) => {
  const parsed = orderCaptureSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Provide a valid payment request and PayPal order.");
  if (!paypalIsConfigured()) throw new HttpError(503, "PayPal Sandbox is not configured yet.");

  const request = await PaymentRequest.findOne({
    publicId: parsed.data.paymentRequestId,
    orderId: parsed.data.orderId
  });
  if (!request) throw new HttpError(404, "This PayPal order does not match a payment request.");
  if (request.status === "paid") {
    return res.json({ request: asPublicRequest(request) });
  }

  const order = await captureOrder(parsed.data.orderId);
  const verifiedCapture = validateCompletedCapture(order, request);
  if (!verifiedCapture) {
    throw new HttpError(502, "PayPal did not confirm the expected amount. Contact support before retrying.");
  }

  const updated = await PaymentRequest.findOneAndUpdate(
    { _id: request._id, status: "pending", orderId: parsed.data.orderId },
    {
      $set: {
        status: "paid",
        captureId: verifiedCapture.captureId,
        payerName: verifiedCapture.payerName,
        checkoutLockUntil: null
      }
    },
    { new: true }
  );

  const finalRequest = updated || await PaymentRequest.findById(request._id);
  if (finalRequest.status !== "paid" || finalRequest.orderId !== parsed.data.orderId) {
    throw new HttpError(409, "Payment confirmation is still processing. Refresh this page shortly.");
  }
  res.json({ request: asPublicRequest(finalRequest) });
}));

const frontendDist = fileURLToPath(new URL("../dist/", import.meta.url));
app.use(express.static(frontendDist));
app.use("/api", (_req, _res, next) => {
  next(new HttpError(404, "PayApp could not find that API endpoint. Restart the server and try again."));
});
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
  res.sendFile("index.html", { root: frontendDist }, (error) => {
    if (error) next(error);
  });
});

app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error("PayApp request failed.", error);
  res.status(status).json({
    error: status >= 500 && !(error instanceof HttpError)
      ? "PayApp could not complete the request. Check the server logs and try again."
      : error.message
  });
});

app.listen(port, () => {
  console.log(`PayApp listening on port ${port} (PayPal Sandbox only).`);
});

async function connectDatabase() {
  let retryDelayMs = 2_000;
  while (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
      console.log("PayApp MongoDB connection is ready.");
      return;
    } catch (error) {
      console.error(`PayApp could not connect to MongoDB: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    }
  }
}

if (process.env.MONGODB_URI) {
  connectDatabase().catch((error) => {
    console.error("Unexpected PayApp MongoDB connection failure.", error);
  });
} else {
  console.warn("MONGODB_URI is not set. The landing page and local session work; database features are unavailable.");
}
