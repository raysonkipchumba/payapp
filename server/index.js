import "dotenv/config";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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
const firebaseAuthDomain = process.env.FIREBASE_AUTH_DOMAIN || `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`;
if (!["http:", "https:"].includes(appBaseUrl.protocol)) {
  throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
}
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (!process.env.FIREBASE_PROJECT_ID) {
  throw new Error("FIREBASE_PROJECT_ID must be set before starting PayApp.");
}
if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set before starting PayApp.");
}

initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });

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
          `https://${firebaseAuthDomain}`,
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://www.googleapis.com"
        ],
        frameSrc: ["https://www.sandbox.paypal.com", "https://*.sandbox.paypal.com", `https://${firebaseAuthDomain}`],
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

const requireFirebaseUser = asyncRoute(async (req, _res, next) => {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "Sign in to view and create your payment requests.");
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
    paypalSandboxConfigured: paypalIsConfigured(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null
  });
});

app.get("/api/requests/:publicId", publicLimiter, asyncRoute(async (req, res) => {
  const parsedId = publicIdSchema.safeParse(req.params.publicId);
  if (!parsedId.success) throw new HttpError(404, "This payment request could not be found.");

  const request = await PaymentRequest.findOne({ publicId: parsedId.data }).lean();
  if (!request) throw new HttpError(404, "This payment request could not be found.");
  res.json({ request: asPublicRequest(request), paypalSandboxConfigured: paypalIsConfigured() });
}));

app.get("/api/me/requests", accountLimiter, requireFirebaseUser, asyncRoute(async (req, res) => {
  const requests = await PaymentRequest.find({ ownerUid: req.firebaseUser.uid })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ requests: requests.map(asOwnerRequest) });
}));

app.post("/api/requests", accountLimiter, requireFirebaseUser, asyncRoute(async (req, res) => {
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
  res.status(201).json({ request: asOwnerRequest(request) });
}));

app.post("/api/checkout/orders", checkoutLimiter, asyncRoute(async (req, res) => {
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

app.post("/api/checkout/capture", checkoutLimiter, asyncRoute(async (req, res) => {
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
      ? "Something went wrong. Please try again."
      : error.message
  });
});

await mongoose.connect(process.env.MONGODB_URI);
app.listen(port, () => {
  console.log(`PayApp API listening on port ${port} (PayPal Sandbox only).`);
});
