import { createHash } from "node:crypto";

const PAYPAL_API = "https://api-m.sandbox.paypal.com";
let cachedAccessToken;
let tokenExpiresAt = 0;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function paypalIsConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function accessToken() {
  if (!paypalIsConfigured()) {
    throw new HttpError(503, "PayPal Sandbox is not configured yet.");
  }

  if (cachedAccessToken && tokenExpiresAt > Date.now() + 60_000) {
    return cachedAccessToken;
  }

  let response;
  try {
    response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(12_000)
    });
  } catch (error) {
    console.error("PayPal Sandbox authentication request failed.", error);
    throw new HttpError(502, "PayPal Sandbox is unavailable. Please try again.");
  }

  if (!response.ok) {
    console.error("PayPal Sandbox authentication failed.", response.status);
    throw new HttpError(502, "PayPal Sandbox authentication failed. Check the server credentials.");
  }

  const token = await response.json();
  if (typeof token.access_token !== "string" || !Number.isFinite(token.expires_in)) {
    throw new HttpError(502, "PayPal Sandbox returned an invalid authentication response.");
  }

  cachedAccessToken = token.access_token;
  tokenExpiresAt = Date.now() + token.expires_in * 1000;
  return cachedAccessToken;
}

async function paypalRequest(path, { method = "GET", body, requestId } = {}) {
  const token = await accessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;

  let response;
  try {
    response = await fetch(`${PAYPAL_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    console.error("PayPal Sandbox API request failed.", error);
    throw new HttpError(502, "PayPal Sandbox is unavailable. Please try again.");
  }

  if (!response.ok) {
    console.error("PayPal Sandbox API returned an error.", response.status);
    throw new HttpError(502, "PayPal Sandbox could not complete the request. Please try again.");
  }
  return response.json();
}

export async function createOrder(paymentRequest) {
  const amount = (paymentRequest.amountCents / 100).toFixed(2);
  const response = await paypalRequest("/v2/checkout/orders", {
    method: "POST",
    requestId: createHash("sha256").update(`payapp-order:${paymentRequest.publicId}`).digest("hex").slice(0, 32),
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: paymentRequest.publicId,
          custom_id: paymentRequest.publicId,
          invoice_id: paymentRequest.publicId,
          description: paymentRequest.description,
          amount: { currency_code: paymentRequest.currency, value: amount }
        }
      ],
      application_context: {
        brand_name: "PayApp",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW"
      }
    }
  });

  if (typeof response.id !== "string") {
    throw new HttpError(502, "PayPal Sandbox did not return a valid order.");
  }
  return response.id;
}

export async function captureOrder(orderId) {
  const requestId = createHash("sha256").update(`payapp-capture:${orderId}`).digest("hex").slice(0, 32);
  return paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    requestId,
    body: {}
  });
}

export function validateCompletedCapture(order, paymentRequest) {
  if (!order || order.status !== "COMPLETED" || !Array.isArray(order.purchase_units)) return null;

  const unit = order.purchase_units.find(
    (purchaseUnit) =>
      purchaseUnit.custom_id === paymentRequest.publicId &&
      purchaseUnit.invoice_id === paymentRequest.publicId &&
      purchaseUnit.amount?.currency_code === paymentRequest.currency &&
      purchaseUnit.amount?.value === (paymentRequest.amountCents / 100).toFixed(2)
  );
  if (!unit) return null;

  const capture = unit.payments?.captures?.find(
    (item) =>
      item.status === "COMPLETED" &&
      item.amount?.currency_code === paymentRequest.currency &&
      item.amount?.value === (paymentRequest.amountCents / 100).toFixed(2)
  );
  if (!capture || typeof capture.id !== "string") return null;

  const parts = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(
    (part) => typeof part === "string" && part.trim().length > 0
  );
  return { captureId: capture.id, payerName: parts.join(" ").slice(0, 100) || null };
}
