-- Fix favorites table: ensure id column has a UUID default
-- The table was originally created by Prisma which generates IDs client-side,
-- but the Go backend relies on Postgres-generated defaults.
ALTER TABLE favorites ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
