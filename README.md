# PayApp

PayApp is currently in **standalone local-preview mode**. The React and Bootstrap 5 frontend runs without calling the API, Firebase, MongoDB, or PayPal.

## Preview

```text
npm install
npm run dev
```

Open `http://localhost:5173`. The landing page and the **Overview**, **Balance**, **Activity**, **Request**, and **Help** dashboard tabs work without backend services. Requests are unsent drafts saved in this browser's local storage. They cannot be shared or paid, and clearing site data removes them.

The mobile dashboard has a bottom navigation bar. Account options are in the top-right menu.

## Backend integrations

The Express/MongoDB, optional Firebase Authentication, and PayPal Sandbox integrations remain in `server/`, but are temporarily disconnected from the frontend. The preview has no sign-in, does not create payment links, and does not process or record real or Sandbox payments.

When you are ready to restore them, configure the server using `.env.example` and use `npm run dev:server` to start the API separately. Review the PayPal Sandbox limitations and production requirements before enabling real payments.
