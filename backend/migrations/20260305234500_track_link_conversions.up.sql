ALTER TABLE users ADD COLUMN custom_link_id TEXT REFERENCES custom_links(id) ON DELETE SET NULL;
CREATE INDEX idx_users_custom_link_id ON users(custom_link_id);

ALTER TABLE credit_purchases ADD COLUMN custom_link_id TEXT REFERENCES custom_links(id) ON DELETE SET NULL;
CREATE INDEX idx_credit_purchases_custom_link_id ON credit_purchases(custom_link_id);
