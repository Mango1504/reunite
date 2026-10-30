# Leo Reunite security hardening checklist

This checklist tracks fixes that have been implemented, deployed, and verified. An item is marked complete only after the relevant production change is confirmed.

## P0 — before wider public launch

- [ ] Remove legacy anonymous messaging RPCs and keep only device-scoped public messaging APIs.
- [ ] Harden every `SECURITY DEFINER` function with an empty search path and fully qualified names.
- [ ] Enforce message request status, expiry, and blocking rules in the database.
- [ ] Stop persisting cloud account data in `localStorage` after logout.
- [ ] Protect pet photos with an intentional private/public storage model and signed URLs where needed.
- [ ] Add abuse protection for anonymous messages and reports.

## P1 — launch quality

- [ ] Strengthen password policy and improve confirmation/reset states.
- [ ] Add complete account deletion and reconcile retention wording with database behavior.
- [ ] Add security headers and connect the stable production domain.
- [ ] Remove obsolete UI/API code paths and add automated auth/messaging tests.
- [ ] Complete dependency vulnerability auditing in CI.

## P2 — polish

- [ ] Improve auth accessibility, focus management, and mobile edge cases.
- [ ] Reduce and clarify location data collection and retention.
