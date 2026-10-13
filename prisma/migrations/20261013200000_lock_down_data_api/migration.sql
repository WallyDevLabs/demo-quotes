-- Supabase exposes every table in "public" through its Data API (PostgREST) to the anon and authenticated
-- roles. This app never uses that API: it talks to Postgres directly as the table owner, which bypasses
-- row level security. So switch RLS on for every table with NO policies (nothing is readable through the
-- API) and take the API roles' privileges away. On a plain Postgres these statements change nothing.
-- Tables added by later migrations must be covered too: see docs/DEPLOYMENT.md (Supabase).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END $$;
