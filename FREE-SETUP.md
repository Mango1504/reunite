# Free production setup

The Render static site is free to host, but it must not be used as a database: free hosted service files are ephemeral. Reunite is prepared for Supabase Free for cloud accounts, PostgreSQL persistence, row-level security, and realtime messages.

1. Create a free Supabase project.
2. Run `schema.sql` in the Supabase SQL Editor.
3. Copy the project URL and the public `anon` key.
4. Add these Render environment variables to the `reunite` static site:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Redeploy.

Never use or expose a Supabase service-role key in this frontend. Until these variables are configured, the app intentionally shows a local demo mode and stores data only in the current browser.
