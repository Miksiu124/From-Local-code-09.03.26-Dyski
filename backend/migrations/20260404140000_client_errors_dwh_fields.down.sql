DROP INDEX IF EXISTS idx_client_error_logs_kind_created;
DROP INDEX IF EXISTS idx_client_error_logs_fingerprint_created;

ALTER TABLE client_error_logs
    DROP COLUMN IF EXISTS extra,
    DROP COLUMN IF EXISTS release,
    DROP COLUMN IF EXISTS browser_family,
    DROP COLUMN IF EXISTS error_kind,
    DROP COLUMN IF EXISTS fingerprint;
