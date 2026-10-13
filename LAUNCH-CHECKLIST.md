# TROP Trade Analyst — launch checklist

## Product before public launch
- [ ] Decide whether the app is only educational analysis or offers regulated financial services; check applicable local laws before marketing it.
- [ ] Replace every illustrative price and label with approved data before describing it as live.
- [ ] Obtain market-data rights that explicitly permit commercial display to customers.
- [ ] Add a support email, Terms of Service, Privacy Policy, and a plain-language refund/cancellation policy.
- [ ] Test on a narrow Android screen and a desktop browser.

## Hosting and payments
- [ ] Deploy the Node service with HTTPS and a persistent data directory.
- [ ] Set `APP_URL`, `SESSION_SECRET`, and `NODE_ENV=production` on the server.
- [ ] Finish Flutterwave account verification and confirm which collections and payouts are enabled for your account.
- [ ] Test with Flutterwave test keys before switching to live keys.
- [ ] Set the Flutterwave webhook to `https://YOUR-DOMAIN/api/payments/webhook` and enter the same random webhook hash in `.env` and Flutterwave.
- [ ] Verify a successful payment activates Pro; verify cancelled/failed/unpaid payments do not.
- [ ] Test access expiry, refunds, duplicate notifications, password reset/support process, and database backups.

## First customers
- [ ] Start with a small beta group and ask what analysis they would actually pay for.
- [ ] Clearly label data timestamps, time zones, delayed quotes, and sample/demo values.
- [ ] Offer a free preview and test the proposed UGX 35,000 monthly / UGX 350,000 annual pricing with real prospective customers.
- [ ] Never promise profits or publish a trade signal as guaranteed.
