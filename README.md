# PayApp

PayApp is a small payment-request application built with React, Bootstrap 5, Express, MongoDB, Firebase Authentication, and the PayPal **Sandbox** Checkout API.

## What works

- Firebase email/password sign-up and sign-in.
- Authenticated users can create USD payment requests from $0.01 through $5,000.
- Each request gets a shareable link. A payer can open the link and check out with a PayPal Sandbox account.
- The server creates and captures the PayPal order. It marks a request paid only after verifying the Sandbox capture, request ID, currency, and exact amount.
- Request records are stored in MongoDB and scoped to the signed-in user's Firebase ID.
- Repeated checkout requests reuse the stored PayPal order; capture calls use a stable PayPal idempotency key.

## Important payment limitations

This project is configured for **PayPal Sandbox only**. Sandbox payments use test accounts and are not real-money transactions. PayPal Checkout pays the merchant account associated with the configured Sandbox app; it does **not** transfer money directly between PayPal users, retrieve a user's PayPal balance or transaction history, or pay out to a request creator. PayApp is not a PayPal website or wallet. Do not use this starter to collect production funds without a separate review of PayPal marketplace/onboarding requirements, regulatory obligations, and production security.

## Requirements

- Node.js 20 or newer and npm.
- A MongoDB instance and connection URI.
- A Firebase project with Email/Password sign-in enabled.
- A PayPal Developer Sandbox REST app, with its Sandbox client ID and secret.

## Configure

1. Copy `.env.example` to `.env` in the project root.
2. Set `MONGODB_URI`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET`.
3. Create `.env.local` in the project root and set your Firebase web app's public configuration. Set `VITE_FIREBASE_AUTH_DOMAIN` to the same domain as the server-side `FIREBASE_AUTH_DOMAIN`:

   ```dotenv
   VITE_FIREBASE_API_KEY=your-firebase-web-api-key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
   VITE_FIREBASE_APP_ID=your-firebase-web-app-id
   ```

   Firebase web configuration is public client configuration, not a substitute for the PayPal server secret. Never put `PAYPAL_CLIENT_SECRET` or a Firebase service-account private key in a `VITE_` variable or commit either secret.
4. In Firebase Console, enable **Authentication → Sign-in method → Email/Password**. Add your local development domain (`localhost`) to Firebase's authorized domains if it is not already listed.
5. In PayPal Developer Dashboard, create a Sandbox REST app and use its Sandbox client ID and secret. Use Sandbox buyer accounts to test checkout.
6. Set `APP_BASE_URL` and `CORS_ORIGINS` to the deployed frontend's trusted origin when deploying. Never allow arbitrary production origins.

## Run locally

```text
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite development server serves React and proxies `/api` requests to Express on port 3001. `npm run build` produces a frontend build for Express to serve. Set `APP_BASE_URL` to the site origin and start the API using `npm start` to run the built app.

The server requires a reachable MongoDB connection and `FIREBASE_PROJECT_ID`. PayPal checkout remains disabled until both Sandbox credentials are configured. The health endpoint at `/api/health` reports database readiness and whether Sandbox credentials are present; it never returns credentials.
