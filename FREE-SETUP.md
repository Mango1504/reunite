# Free production setup

The Render static site is free to host, but it must not be used as a database: free hosted service files are ephemeral. Reunite is prepared for Supabase Free for cloud accounts, PostgreSQL persistence, row-level security, and realtime messages.

1. Create a free Supabase project.
2. Run `schema.sql` in the Supabase SQL Editor.
3. Copy the project URL and the public `anon` key.
4. Add these Render environment variables to the `reunite` static site:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Redeploy.

## Email confirmation branding

In Supabase Dashboard → Authentication → Email Templates → Confirm signup:

- Set the subject to `Leo Reunite authentication request`.
- Paste the contents of `supabase/email-templates/confirmation.html` into the body.
- Set the production Site URL and redirect URL before testing the link.

The app sends confirmation links back to the current Leo Reunite site automatically.

The current schema supports multiple pets per account and realtime inbox refreshes. If you already have a Supabase project, rerun `supabase/schema.sql` before deploying this version; the migration adds coordinate validation, indexes, and stricter message write policies.

Never use or expose a Supabase service-role key in this frontend. Until these variables are configured, the app intentionally shows a local demo mode and stores data only in the current browser.
