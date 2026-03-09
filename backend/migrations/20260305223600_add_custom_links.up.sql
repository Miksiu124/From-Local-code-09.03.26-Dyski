CREATE TABLE custom_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    destination TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL
);

CREATE INDEX idx_custom_links_slug ON custom_links(slug);
CREATE INDEX idx_custom_links_is_active ON custom_links(is_active);

CREATE TABLE link_visits (
    id TEXT PRIMARY KEY,
    custom_link_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    referer TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_custom_link FOREIGN KEY (custom_link_id) REFERENCES custom_links(id) ON DELETE CASCADE
);

CREATE INDEX idx_link_visits_custom_link_id ON link_visits(custom_link_id);
CREATE INDEX idx_link_visits_custom_link_id_created_at ON link_visits(custom_link_id, created_at);
CREATE INDEX idx_link_visits_created_at ON link_visits(created_at);
