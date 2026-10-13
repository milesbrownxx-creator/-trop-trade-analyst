# TROP Trade Analyst — starter app

A mobile-friendly market-analysis web app branded for Agona Peter. It includes a market dashboard, starter asset list, watchlist, educational market briefs, signup/sign-in, a SQLite user database, and Flutterwave checkout scaffolding for paid Pro access.

**Important:** the included prices and charts are illustrative demo values until you configure a licensed data provider. The built-in rule-based report is not a proprietary or predictive trading model. TROP does not execute trades or promise profits.

## Interface refresh (October 2026)

The refreshed dashboard uses a more professional terminal layout with a horizontal market board, candlestick-style price display, indicative volume bars, selectable chart windows, and high/low/window-move metrics. Demo quotes and generated candle/volume data remain clearly labelled as illustrative until the server is configured with suitable licensed market data. Do not present the sample values as live market prices.

## Included features

- Responsive web dashboard for phones and computers.
- Starter symbols: BTC/USD, ETH/USD, EUR/USD, AAPL, XAU/USD.
- Watchlist saved in the browser.
- Rule-based demo market briefs; optional OpenAI API-powered brief when configured.
- User accounts with hashed passwords and server-side sessions.
- 30-day and 365-day Pro checkout starter via Flutterwave Standard Checkout (one-time payment; manual renewal).
- Server-side payment verification and signed webhook handling before upgrading a user's access.
- Optional Twelve Data connection. Confirm commercial display and redistribution rights before selling access to market data.
- Progressive web app manifest and service-worker cache for a basic installable experience.

## Run locally on Windows

1. Install Node.js 20 or newer from https://nodejs.org/.
2. Extract the ZIP into a folder.
3. Open Command Prompt or PowerShell in that folder.
4. Copy `.env.example` to `.env`. The default local session secret works for local testing, but replace it with a strong random value for hosting.
5. Run `npm install`.
6. Run `npm start`.
7. Open http://localhost:3000 in a browser.

The front-end can also be opened as `public/index.html` to preview the design, but login, paid checkout, connected data, and server-powered analysis require the server.

## Configure paid access

1. Create a Flutterwave merchant account and complete its required identity/business checks and website review.
2. Start with test credentials. Copy your Flutterwave public key, secret key, and webhook secret hash into the hosting provider's environment variables. Do not put secret credentials in any public HTML or commit a `.env` file.
3. Set `APP_URL` to the exact public HTTPS URL of the deployed site.
4. Set `FLW_SECRET_HASH` to the same random webhook secret hash entered in Flutterwave's webhook settings.
5. Add the webhook URL `https://YOUR-DOMAIN/api/payments/webhook` to Flutterwave and subscribe to payment-completion events.
6. Run test transactions and confirm that a Pro entitlement is applied only after server-side verification. Test successful, cancelled, failed, pending, duplicate-webhook, and underpaid cases.
7. Only after testing, add live credentials and confirm fees, settlement/payout options, refunds, and available payment methods in your own account.

The included launch prices are editable in two places: `PLANS` in `server.js` and the plan cards in `public/index.html`. They are a proposal, not a promise that Flutterwave has approved your exact prices, recurrence method, or payout method. The current code sells a fixed 30-day or 365-day access period with one-time checkout. Users must renew manually.

## Configure market data

1. Sign up with a supported market-data provider and read the exact plan and display/redistribution terms.
2. Put the API key into `TWELVE_DATA_API_KEY` on the server.
3. The current integration requests daily time series from Twelve Data for starter symbols.
4. The sample returns live provider data only for Pro users when the key exists. It switches to labeled sample values for the free preview.
5. A free or personal-use data plan may not allow you to display or redistribute quotes to paying customers. Buy the suitable commercial plan and check exchange permissions before launch.

## Configure AI analysis (optional)

Set `OPENAI_API_KEY` and optionally `OPENAI_MODEL` in the server environment. The secret remains on the server. Without it, the premium endpoint returns a structured rule-based market brief based on the available series rather than claiming to be an AI model.

## Deployment outline

Deploy as a Node.js web service on a host that supports Node 20+, environment variables, HTTPS, and persistent disk storage. Add a persistent disk for the `data/` directory because both user/payment records and sessions are SQLite files. Set `NODE_ENV=production`, a strong `SESSION_SECRET` (at least 32 characters), `APP_URL`, and your provider keys. Configure the webhook using your public domain. Do not deploy the SQLite app on an ephemeral filesystem or run multiple instances sharing one SQLite file. For larger traffic, migrate to managed PostgreSQL and a shared session store.

Before accepting real customers, add a real support email, Terms of Service, Privacy Policy, cancellation/refund policy, data-provider attribution, and appropriate business/tax disclosures. Confirm local laws and any obligations that apply to financial-analysis products. Keep the product informational and do not market unverified alerts as guaranteed profitable signals.

## Project structure

- `public/index.html` — interface and front-end demo logic
- `public/manifest.json` — install metadata
- `public/sw.js` — basic offline asset caching
- `server.js` — authentication, market-data proxy, analysis, checkout, payment verification
- `.env.example` — server configuration template
- `package.json` — application dependencies and start scripts

## Security checklist before launch

- Use HTTPS and strong unique secrets.
- Use Flutterwave live keys only in environment settings, never in browser code.
- Verify every payment on the server; do not grant access based on a redirect alone.
- Set webhook secret hash and monitor webhook processing.
- Configure backups for the persistent database.
- Test rate limits and account flows.
- Publish clear terms, privacy and refund/cancellation policies.
- Obtain a commercial data license before redistributing live prices.
