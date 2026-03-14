-- Referral link click tracking and A/B variants
CREATE TABLE referral_link_visits (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    referer TEXT,
    variant_key TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_referral_visit_referrer FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_referral_link_visits_referrer ON referral_link_visits(referrer_id);
CREATE INDEX idx_referral_link_visits_referrer_created ON referral_link_visits(referrer_id, created_at);
CREATE INDEX idx_referral_link_visits_variant ON referral_link_visits(referrer_id, variant_key);
CREATE INDEX idx_referral_link_visits_created ON referral_link_visits(created_at);

-- Optional: named variants for A/B testing (e.g. summer, winter campaigns)
CREATE TABLE referral_link_variants (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    variant_key TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_referral_variant_referrer FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT uq_referrer_variant UNIQUE (referrer_id, variant_key)
);

CREATE INDEX idx_referral_link_variants_referrer ON referral_link_variants(referrer_id);
