package main

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"content-platform-backend/internal/config"
	"content-platform-backend/internal/database"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	log.Println("Starting seed script...")

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	ctx := context.Background()
	db, err := database.NewPostgresPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Println("Connected to database")

	// ── Countries ────────────────────────────────────────────────────────
	countries := []struct {
		Name, Code, FlagEmoji string
	}{
		{"United States", "US", "\U0001F1FA\U0001F1F8"},
		{"United Kingdom", "GB", "\U0001F1EC\U0001F1E7"},
		{"Poland", "PL", "\U0001F1F5\U0001F1F1"},
		{"Germany", "DE", "\U0001F1E9\U0001F1EA"},
		{"France", "FR", "\U0001F1EB\U0001F1F7"},
		{"Spain", "ES", "\U0001F1EA\U0001F1F8"},
		{"Italy", "IT", "\U0001F1EE\U0001F1F9"},
		{"Brazil", "BR", "\U0001F1E7\U0001F1F7"},
		{"Canada", "CA", "\U0001F1E8\U0001F1E6"},
		{"Australia", "AU", "\U0001F1E6\U0001F1FA"},
		{"Japan", "JP", "\U0001F1EF\U0001F1F5"},
		{"South Korea", "KR", "\U0001F1F0\U0001F1F7"},
		{"Russia", "RU", "\U0001F1F7\U0001F1FA"},
		{"Ukraine", "UA", "\U0001F1FA\U0001F1E6"},
		{"Czech Republic", "CZ", "\U0001F1E8\U0001F1FF"},
		{"Romania", "RO", "\U0001F1F7\U0001F1F4"},
		{"Hungary", "HU", "\U0001F1ED\U0001F1FA"},
		{"Colombia", "CO", "\U0001F1E8\U0001F1F4"},
		{"Argentina", "AR", "\U0001F1E6\U0001F1F7"},
		{"Mexico", "MX", "\U0001F1F2\U0001F1FD"},
		{"Other", "XX", "\U0001F30D"},
	}

	for _, c := range countries {
		_, err := db.Exec(ctx, `
			INSERT INTO countries (name, code, flag_emoji)
			VALUES ($1, $2, $3)
			ON CONFLICT (code) DO NOTHING
		`, c.Name, c.Code, c.FlagEmoji)
		if err != nil {
			log.Printf("Failed to seed country %s: %v", c.Code, err)
		}
	}
	log.Printf("Seeded %d countries", len(countries))

	// ── Settings ─────────────────────────────────────────────────────────
	type setting struct {
		Key         string
		Value       interface{}
		Description string
	}
	settings := []setting{
		{"model_credit_cost_7d", 30, "Credit cost for 7-day access to a single model"},
		{"model_credit_cost_30d", 50, "Credit cost for 30-day access to a single model"},
		{"bundle_credit_cost_14d", 500, "Credit cost for 14-day bundle access"},
		{"bundle_credit_cost_30d", 900, "Credit cost for 30-day bundle access"},
		{"default_country_id", "XX", "Default country code for imported models"},
		{"blik_expiration_minutes", 5, "BLIK payment expiration time in minutes"},
		{"crypto_expiration_hours", 48, "Crypto payment expiration time in hours"},
		{"paypal_expiration_hours", 1, "PayPal payment expiration time in hours"},
		{"revolut_expiration_hours", 1, "Revolut payment expiration time in hours"},
		{"max_pending_credit_purchases", 3, "Max pending credit purchases per user"},
		{"crypto_wallets", map[string]string{"BTC": "", "ETH": "", "USDT": "", "USDC": ""}, "Crypto wallet addresses"},
	}

	for _, s := range settings {
		valJSON, _ := json.Marshal(s.Value)
		_, err := db.Exec(ctx, `
			INSERT INTO settings (key, value, description, updated_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (key) DO NOTHING
		`, s.Key, string(valJSON), s.Description, time.Now())
		if err != nil {
			log.Printf("Failed to seed setting %s: %v", s.Key, err)
		}
	}
	log.Printf("Seeded %d settings", len(settings))

	// ── Admin user ───────────────────────────────────────────────────────
	hashed, err := bcrypt.GenerateFromPassword([]byte("admin123"), 12)
	if err != nil {
		log.Printf("Failed to hash admin password: %v", err)
	} else {
		_, err = db.Exec(ctx, `
			INSERT INTO users (email, password, name, role, credit_balance)
			VALUES ($1, $2, $3, 'ADMIN', 0)
			ON CONFLICT (email) DO NOTHING
		`, "admin@contentvault.com", string(hashed), "Admin")
		if err != nil {
			log.Printf("Failed to seed admin user: %v", err)
		} else {
			log.Println("Seeded admin user (admin@contentvault.com)")
		}
	}

	// ── Credit packages ──────────────────────────────────────────────────
	packages := []struct {
		Name    string
		Credits int
		Price   float64
		Tier    int
	}{
		{"Starter", 50, 5.0, 1},
		{"Popular", 120, 10.0, 2},
		{"Pro", 300, 25.0, 3},
		{"Ultimate", 700, 50.0, 4},
	}

	for _, p := range packages {
		var exists bool
		_ = db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM credit_packages WHERE name = $1)`, p.Name).Scan(&exists)
		if !exists {
			_, err := db.Exec(ctx, `
				INSERT INTO credit_packages (name, credits, price, tier)
				VALUES ($1, $2, $3, $4)
			`, p.Name, p.Credits, p.Price, p.Tier)
			if err != nil {
				log.Printf("Failed to seed package %s: %v", p.Name, err)
			}
		}
	}
	log.Printf("Seeded %d credit packages", len(packages))

	log.Println("Seed script completed successfully")
}
