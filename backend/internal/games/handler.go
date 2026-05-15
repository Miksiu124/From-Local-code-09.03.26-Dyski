package games

import (
	"crypto/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"content-platform-backend/internal/common"
	"content-platform-backend/internal/middleware"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

type Handler struct {
	db *pgxpool.Pool
	rl *middleware.RateLimiter
}

func NewHandler(db *pgxpool.Pool, rl *middleware.RateLimiter) *Handler {
	return &Handler{db: db, rl: rl}
}

type coinflipPlayRequest struct {
	BetCredits int    `json:"betCredits"`
	Choice     string `json:"choice"` // HEADS | TAILS
}

func (h *Handler) CoinflipPlay(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}

	if h.rl != nil {
		if rl, err := h.rl.Check("coinflip:user:"+userID, 15, 60*1000); err == nil && rl != nil && !rl.Allowed {
			retrySecs := int((rl.ResetAt-time.Now().UnixMilli())/1000) + 1
			if retrySecs < 1 {
				retrySecs = 1
			}
			return common.RateLimited(c, retrySecs, "Too many coinflip rounds. Please wait.")
		}
	}

	var req coinflipPlayRequest
	if err := c.Bind(&req); err != nil {
		return common.BadRequest(c, "Invalid request body")
	}
	choice := strings.ToUpper(strings.TrimSpace(req.Choice))
	if choice != "HEADS" && choice != "TAILS" {
		return common.BadRequest(c, "choice must be HEADS or TAILS")
	}
	if req.BetCredits < 5 || req.BetCredits > 500 {
		return common.BadRequest(c, "Bet must be between 5 and 500 credits")
	}

	var randomByte [1]byte
	if _, err := rand.Read(randomByte[:]); err != nil {
		return common.InternalError(c)
	}
	result := "HEADS"
	if randomByte[0]%2 == 1 {
		result = "TAILS"
	}
	won := result == choice
	payout := 0
	delta := -req.BetCredits
	if won {
		payout = req.BetCredits * 2
		delta = req.BetCredits
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return common.InternalError(c)
	}
	defer tx.Rollback(ctx)

	var balance int
	if err := tx.QueryRow(ctx, `SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return common.InternalError(c)
	}
	if balance < req.BetCredits {
		return common.BadRequest(c, "Insufficient credits")
	}

	var roundID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO coinflip_rounds (user_id, bet_credits, user_choice, result, won, payout_credits)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, userID, req.BetCredits, choice, result, won, payout).Scan(&roundID); err != nil {
		return common.InternalError(c)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2
	`, delta, userID); err != nil {
		return common.InternalError(c)
	}

	desc := "Coinflip loss"
	if won {
		desc = "Coinflip win"
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO credit_transactions (user_id, type, amount, description)
		VALUES ($1, 'ADJUSTMENT', $2, $3)
	`, userID, delta, desc); err != nil {
		return common.InternalError(c)
	}

	if err := tx.Commit(ctx); err != nil {
		return common.InternalError(c)
	}

	return common.Success(c, map[string]interface{}{
		"id":            roundID,
		"choice":        choice,
		"result":        result,
		"won":           won,
		"betCredits":    req.BetCredits,
		"payoutCredits": payout,
		"deltaCredits":  delta,
		"creditBalance": balance + delta,
	})
}

func (h *Handler) CoinflipHistory(c echo.Context) error {
	ctx := c.Request().Context()
	userID := middleware.GetUserID(c)
	if userID == "" {
		return common.Unauthorized(c)
	}
	limit := 20
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	rows, err := h.db.Query(ctx, `
		SELECT id, bet_credits, user_choice, result, won, payout_credits, created_at::text
		FROM coinflip_rounds
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return common.InternalError(c)
	}
	defer rows.Close()

	out := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, choice, result, createdAt string
		var betCredits, payoutCredits int
		var won bool
		if scanErr := rows.Scan(&id, &betCredits, &choice, &result, &won, &payoutCredits, &createdAt); scanErr != nil {
			return common.InternalError(c)
		}
		out = append(out, map[string]interface{}{
			"id":            id,
			"betCredits":    betCredits,
			"choice":        choice,
			"result":        result,
			"won":           won,
			"payoutCredits": payoutCredits,
			"createdAt":     createdAt,
		})
	}
	return c.JSON(http.StatusOK, out)
}
