-- Row Level Security on every table, with NO policies.
--
-- The API connects as the table owner (role "postgres" on Supabase), which bypasses RLS, and
-- enforces per-user/org isolation itself. Any other role is denied every row. On Supabase this
-- closes the auto-generated REST/GraphQL API (roles "anon" and "authenticated") over these
-- tables: with RLS off, anyone holding the project's public anon key could read customer
-- addresses. On plain Postgres/PGlite it is harmless.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "route_events" ENABLE ROW LEVEL SECURITY;
