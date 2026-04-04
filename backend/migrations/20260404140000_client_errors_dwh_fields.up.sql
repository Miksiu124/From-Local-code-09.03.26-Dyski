ALTER TABLE client_error_logs
    ADD COLUMN IF NOT EXISTS fingerprint varchar(64) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS error_kind varchar(32) NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS browser_family varchar(32) NOT NULL DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS release text,
    ADD COLUMN IF NOT EXISTS extra jsonb;

CREATE INDEX IF NOT EXISTS idx_client_error_logs_fingerprint_created
    ON client_error_logs (fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_error_logs_kind_created
    ON client_error_logs (error_kind, created_at DESC);

UPDATE client_error_logs
SET fingerprint = encode(
        digest(
                lower(trim(message)) || E'\n' || coalesce(
                        nullif(
                                trim((regexp_split_to_array(coalesce(stack, ''), E'\n'))[1]),
                                ''
                        ),
                        ''
                ),
                'sha256'
        ),
        'hex'
    )
WHERE fingerprint = '';
