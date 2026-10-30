# Leo Reunite security hardening checklist

This checklist tracks fixes that have been implemented, deployed, and verified. An item is marked complete only after the relevant production change is confirmed.

## P0 — before wider public launch

- [x] Remove legacy anonymous messaging RPCs and keep only device-scoped public messaging APIs. User confirmed the live Supabase migration ran; automated result inspection was blocked by the browser permission.
- [x] Harden every `SECURITY DEFINER` function with an empty search path and fully qualified names. User confirmed the live migration ran; automated result inspection was blocked by the browser permission.
- [x] Enforce message request status, expiry, and blocking rules in the database. User confirmed the live migration ran; automated result inspection was blocked by the browser permission.
- [x] Stop persisting cloud account data in `localStorage` after logout. Deployed in `562dead` and verified as the latest successful Render deployment.
- [x] Protect pet photos with an intentional public-media model, server-side type/size limits, and owner deletion controls. Deployed in `d530b4b`; storage migration user-confirmed.
- [x] Add device-scoped cooldowns and abuse limits for anonymous messages and reports. User confirmed the live migration ran; automated result inspection was blocked by the browser permission.

## P1 — launch quality

- [x] Strengthen password policy and improve confirmation/reset states. Frontend minimum is live in `9f67d4d`; user confirmed Supabase Auth minimum is 8 characters and leaked-password protection is enabled.
- [ ] Add complete account deletion and reconcile retention wording with database behavior. UI/privacy code is live in `234385b`; run `20261030_add_account_deletion.sql` in Supabase before marking complete.
- [ ] Add security headers and connect the stable production domain.
- [ ] Remove obsolete UI/API code paths and add automated auth/messaging tests.
- [ ] Complete dependency vulnerability auditing in CI.

## P2 — polish

- [ ] Improve auth accessibility, focus management, and mobile edge cases.
- [ ] Reduce and clarify location data collection and retention.
