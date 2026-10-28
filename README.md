# Swad Sangam — restaurant ordering website

Responsive restaurant storefront + cart + checkout + owner dashboard. Frontend is static and suitable for GitHub Pages. Supabase stores real orders and menu data; Supabase Edge Functions validate prices and process checkout. Razorpay handles online payment. Cash on delivery/pickup is supported.

## Project structure

- `index.html` — public website and checkout
- `admin.html` — owner login, orders, menu management, restaurant settings
- `assets/config.js` — public Supabase URL/anon key and public settings
- `assets/app.js`, `assets/admin.js`, `assets/style.css` — frontend
- `supabase/schema.sql` — database tables, policies and starter menu
- `supabase/functions/create-order` — server-side price validation and order creation
- `supabase/functions/verify-payment` — verifies Razorpay signature and captured payment
- `supabase/functions/whatsapp-notify` — optional WhatsApp Cloud API sender

## Before you begin

You need a Supabase project, GitHub account/repository, Razorpay account for online payments, and optionally a Meta WhatsApp Business Platform app. This is source code, not a deployed/connected service. Do not accept real orders until all setup and tests below pass.

## 1. Create Supabase project and database

1. Create a project at https://supabase.com/dashboard. Choose a region appropriate for your users if available.
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.
3. In **Authentication → Users**, create the restaurant owner user with a strong password.
4. Copy the owner's user UUID from the Users screen.
5. In SQL Editor, run this, replacing the UUID with the actual owner user ID:

   ```sql
   insert into public.admin_users (user_id)
   values ('PASTE-OWNER-USER-UUID-HERE');
   ```

   Do not add an untrusted user to `admin_users`. Do not expose the Supabase service role key in any browser file.

6. In Project Settings → API, copy the project URL and anon/publishable key into `assets/config.js`. Set `RESTAURANT_WHATSAPP` to the restaurant's WhatsApp number with country code digits only, e.g. `91XXXXXXXXXX`. Set the Razorpay **Key ID** in the config. Key ID is public; Key Secret is server-only.

## 2. Configure Edge Function secrets

Install Supabase CLI: https://supabase.com/docs/guides/cli then log in and link the project. From the project root, deploy:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-order
supabase functions deploy verify-payment
supabase functions deploy whatsapp-notify
```

Set secrets (replace placeholders locally; never commit actual values):

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=your_razorpay_test_secret ALLOWED_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io
```

For a GitHub project site, `ALLOWED_ORIGIN` should be the exact origin (scheme + hostname, no path), e.g. `https://username.github.io`. For a custom domain, use that domain. If using both origins, update CORS code to allowlist both explicitly rather than using `*`. Redeploy after code changes. Do not use production Razorpay keys until test mode has been thoroughly verified.

### Payment capture setup

The verification function expects Razorpay payment status `captured`. In Razorpay dashboard, configure capture settings to auto-capture payments, or implement a server-side capture step. Add a Razorpay webhook for `payment.captured` as a production reliability improvement; browser callbacks alone are not a complete payment notification strategy. Never mark an order paid solely because the browser says payment succeeded.

## 3. Configure WhatsApp notifications

Two levels are supported:

- **Simple/manual WhatsApp:** the customer sees a “Send order details on WhatsApp” button after placing an order. This opens a prefilled message to the restaurant's configured number. The customer must press Send. This works without a Meta API token.
- **Automatic Cloud API notifications:** create/configure a WhatsApp Business Platform app at https://developers.facebook.com/docs/whatsapp/cloud-api, obtain a WhatsApp business phone-number ID and access token, and set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and a strong `WHATSAPP_NOTIFY_SECRET` as Supabase function secrets. Deploy the `whatsapp-notify` function. The endpoint requires `x-notify-secret` and is intended for trusted server-to-server calls only. To automatically notify on new orders, configure a secure database webhook/trigger or a trusted server workflow that invokes it with the customer's/order recipient and message. Do not expose the notify secret in frontend JavaScript. For customer-initiated business messages, templates and consent rules may apply; follow Meta's current WhatsApp policies.

Example secrets:
```bash
supabase secrets set WHATSAPP_ACCESS_TOKEN=your_token WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id WHATSAPP_NOTIFY_SECRET=a-long-random-secret
```

The included endpoint is a sender, not a self-triggering database webhook. Automatic notifications need the webhook/workflow wiring and approved WhatsApp setup.

## 4. Publish frontend on GitHub Pages

1. Create a GitHub repository (e.g. `swad-sangam`).
2. Upload `index.html`, `admin.html`, and the entire `assets` folder to the repository root. Keep the `assets` folder name.
3. In repository **Settings → Pages**, choose deploy from the `main` branch and `/ (root)`, then save.
4. Your site will be available at `https://YOUR_GITHUB_USERNAME.github.io/REPOSITORY_NAME/`. For a user/organization site repository named `YOUR_GITHUB_USERNAME.github.io`, it will be at `https://YOUR_GITHUB_USERNAME.github.io/`.
5. Add the published origin to the `ALLOWED_ORIGIN` secret. Make sure the frontend URL and CORS origin match.
6. Test `index.html` and `admin.html` at the published URL. Do not use `file://` to test API requests.

## 5. Set menu, prices and restaurant settings

After login, open **Menu management** to edit starter items, add your real dishes, set correct prices, upload/host images and mark availability. In **Restaurant settings**, set phone, location, hours, delivery fee, minimum order, and whether orders are accepted.

The starter SQL inserts four sample dishes. Replace these prices/descriptions/photos before publishing. Confirm the food photos are licensed for your use.

## 6. Pre-launch test checklist

- [ ] Test with Razorpay test keys only.
- [ ] Confirm customer can browse menu and add/remove quantities.
- [ ] Confirm server recalculates price from database; never trusts a browser-supplied price.
- [ ] Test COD order and verify it appears in owner dashboard.
- [ ] Test online success, failure, cancellation, and a delayed callback.
- [ ] Confirm orders are not marked paid until server verification confirms captured payment.
- [ ] Confirm non-admin account cannot view/edit orders or menu.
- [ ] Confirm owner can change menu/price and the public menu updates.
- [ ] Test pickup, delivery fee, minimum order and unavailable items.
- [ ] Test on Android Chrome and desktop.
- [ ] Test WhatsApp message manually; automatic delivery only after Cloud API workflow is configured.
- [ ] Add privacy policy, terms, cancellation/refund policy, and customer support contact before accepting public orders.

## Security and production notes

- `assets/config.js` contains only public keys. Never put `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, or WhatsApp tokens in frontend files or GitHub.
- Database RLS is enabled. Orders are created only by Edge Functions using a server-side service key, and admin access is controlled by `admin_users`.
- Review Supabase function logs, add rate limiting/abuse protection, configure backup/retention, and set a specific allowed origin before launch.
- For production, add a Razorpay webhook that validates the `X-Razorpay-Signature` header and reconciles captured/failed payments idempotently. Monitor refunds and cancellations.
- The included WhatsApp function does not automatically fire on order creation until connected to a trusted server workflow/webhook.
- Do not advertise delivery time or service areas until the owner confirms them.
- The website is not yet deployed or connected to your accounts. Real credentials, deployment, payment settings and end-to-end testing are required.
