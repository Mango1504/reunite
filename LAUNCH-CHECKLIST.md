# Leo Reunite public launch checklist

## Required in Render/Supabase

- [ ] Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Render.
- [ ] Confirm Render is serving the latest `main` deployment.
- [ ] Enable Supabase email confirmation and configure the production Site URL.
- [ ] Configure Supabase password-reset redirect URLs for the production domain.
- [ ] Review Storage, table, and RPC policies with two separate test accounts.
- [ ] Confirm database backups and retention are enabled.
- [ ] Add an uptime/error monitor and a support contact.
- [ ] Connect `leoreunite.com` when the domain budget is available.

## End-to-end acceptance tests

- [ ] Create account, confirm email, sign in, reset password, and sign out.
- [ ] Create, edit, upload, replace QR, mark missing, and delete a pet.
- [ ] Confirm the old QR stops resolving after replacement.
- [ ] Open a QR as a separate browser/user and send a finder message.
- [ ] Reply from the owner inbox and verify tick states.
- [ ] Verify the finder never sees the owner email or private fields.
- [ ] Verify a two-account test cannot read or modify the other account’s data.
- [ ] Test mobile Safari/Chrome, keyboard navigation, slow network, and blocked location.

## Before announcing publicly

- [ ] Replace the starter Privacy Policy and Terms with reviewed business policies.
- [ ] Add a real support email and a process for profile/report requests.
- [ ] Confirm the public launch URL, social preview, favicon, and sitemap.
- [ ] Keep a physical tag/backup contact recommendation visible to users.
