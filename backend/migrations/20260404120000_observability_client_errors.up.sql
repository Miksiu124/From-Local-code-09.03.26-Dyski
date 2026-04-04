CREATE TABLE client_error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    message text NOT NULL,
    stack text,
    page_path text,
    user_agent text,
    client_ip text,
    component text
);

CREATE INDEX idx_client_error_logs_created ON client_error_logs (created_at DESC);
