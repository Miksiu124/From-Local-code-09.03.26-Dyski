package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	purchaseRiskEventsKey = "risk:purchase:events"
)

type PurchaseRiskDecision struct {
	Blocked           bool   `json:"blocked"`
	RetryAfterSeconds int    `json:"retryAfterSeconds"`
	ErrorCode         string `json:"errorCode,omitempty"`
	Message           string `json:"message,omitempty"`
	Trigger           string `json:"trigger,omitempty"`
	RiskLevel         string `json:"riskLevel,omitempty"`
}

type PurchaseRiskEvent struct {
	Timestamp string `json:"timestamp"`
	Endpoint  string `json:"endpoint"`
	UserID    string `json:"userId,omitempty"`
	IP        string `json:"ip,omitempty"`
	Trigger   string `json:"trigger"`
	Action    string `json:"action"`
	Detail    string `json:"detail,omitempty"`
}

func normalizeIP(ip string) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return "unknown"
	}
	return ip
}

func retryAfterSeconds(resetAtMs int64) int {
	remainingMs := resetAtMs - time.Now().UnixMilli()
	if remainingMs <= 0 {
		return 1
	}
	return int(math.Ceil(float64(remainingMs) / 1000))
}

func bannedIPSignalKey(ip string) string {
	return "risk:banned-ip:" + ip
}

func (rl *RateLimiter) appendPurchaseRiskEvent(ctx context.Context, evt PurchaseRiskEvent) error {
	if rl == nil || rl.redis == nil {
		return nil
	}
	if evt.Timestamp == "" {
		evt.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}
	payload, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	pipe := rl.redis.Pipeline()
	pipe.LPush(ctx, purchaseRiskEventsKey, string(payload))
	pipe.LTrim(ctx, purchaseRiskEventsKey, 0, 199)
	pipe.Publish(ctx, "admin:risk-signals", string(payload))
	_, err = pipe.Exec(ctx)
	return err
}

func MarkBannedIPSignal(ctx context.Context, redisClient *redis.Client, userID, ip string) error {
	if redisClient == nil {
		return nil
	}
	ip = normalizeIP(ip)
	pipe := redisClient.Pipeline()
	pipe.Incr(ctx, bannedIPSignalKey(ip))
	pipe.Expire(ctx, bannedIPSignalKey(ip), 24*time.Hour)
	evt, _ := json.Marshal(PurchaseRiskEvent{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Endpoint:  "auth.middleware",
		UserID:    userID,
		IP:        ip,
		Trigger:   "banned_account_seen",
		Action:    "mark_ip_signal",
		Detail:    "banned user attempted authenticated request",
	})
	pipe.LPush(ctx, purchaseRiskEventsKey, string(evt))
	pipe.LTrim(ctx, purchaseRiskEventsKey, 0, 199)
	pipe.Publish(ctx, "admin:risk-signals", string(evt))
	_, err := pipe.Exec(ctx)
	return err
}

func (rl *RateLimiter) AssessPurchaseRisk(ctx context.Context, userID, ip, endpoint string) (*PurchaseRiskDecision, error) {
	if rl == nil {
		return &PurchaseRiskDecision{RiskLevel: "unknown"}, nil
	}
	ip = normalizeIP(ip)
	decision := &PurchaseRiskDecision{RiskLevel: "normal"}

	ipLimit, err := rl.Check("purchase:ip:"+ip, 20, 60*1000)
	if err != nil {
		return nil, err
	}
	if ipLimit != nil && !ipLimit.Allowed {
		retry := retryAfterSeconds(ipLimit.ResetAt)
		decision.Blocked = true
		decision.RetryAfterSeconds = retry
		decision.ErrorCode = "PURCHASE_IP_RATE_LIMITED"
		decision.Message = "Too many purchase attempts from this network. Please wait and try again."
		decision.Trigger = "ip_rate_limit"
		decision.RiskLevel = "high"
		_ = rl.appendPurchaseRiskEvent(ctx, PurchaseRiskEvent{
			Endpoint: endpoint,
			UserID:   userID,
			IP:       ip,
			Trigger:  decision.Trigger,
			Action:   "blocked",
			Detail:   fmt.Sprintf("retry_after=%ds", retry),
		})
		return decision, nil
	}

	userLimit, err := rl.Check("purchase:user:"+userID, 8, 60*1000)
	if err != nil {
		return nil, err
	}
	if userLimit != nil && !userLimit.Allowed {
		retry := retryAfterSeconds(userLimit.ResetAt)
		decision.Blocked = true
		decision.RetryAfterSeconds = retry
		decision.ErrorCode = "PURCHASE_USER_RATE_LIMITED"
		decision.Message = "Too many purchase attempts for this account. Please wait before trying again."
		decision.Trigger = "user_rate_limit"
		decision.RiskLevel = "high"
		_ = rl.appendPurchaseRiskEvent(ctx, PurchaseRiskEvent{
			Endpoint: endpoint,
			UserID:   userID,
			IP:       ip,
			Trigger:  decision.Trigger,
			Action:   "blocked",
			Detail:   fmt.Sprintf("retry_after=%ds", retry),
		})
		return decision, nil
	}

	bucket := time.Now().Unix() / 600
	ipUsersKey := fmt.Sprintf("risk:purchase:ip-users:%s:%d", ip, bucket)
	pipe := rl.redis.Pipeline()
	pipe.SAdd(ctx, ipUsersKey, userID)
	ipUsersCountCmd := pipe.SCard(ctx, ipUsersKey)
	pipe.Expire(ctx, ipUsersKey, 12*time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, err
	}
	ipUsersCount := ipUsersCountCmd.Val()
	if ipUsersCount > 4 {
		decision.Blocked = true
		decision.RetryAfterSeconds = 300
		decision.ErrorCode = "PURCHASE_MULTI_ACCOUNT_RISK"
		decision.Message = "Unusual purchase activity from this network. Try again in a few minutes."
		decision.Trigger = "ip_multi_account_burst"
		decision.RiskLevel = "high"
		_ = rl.appendPurchaseRiskEvent(ctx, PurchaseRiskEvent{
			Endpoint: endpoint,
			UserID:   userID,
			IP:       ip,
			Trigger:  decision.Trigger,
			Action:   "blocked",
			Detail:   fmt.Sprintf("distinct_users_10m=%d", ipUsersCount),
		})
		return decision, nil
	}

	bannedIPSignals, err := rl.redis.Get(ctx, bannedIPSignalKey(ip)).Int()
	if err != nil && err != redis.Nil {
		return nil, err
	}
	if bannedIPSignals >= 3 {
		decision.RiskLevel = "elevated"
		elevatedLimit, err := rl.Check("purchase:elevated-ip:"+ip, 2, 10*60*1000)
		if err != nil {
			return nil, err
		}
		if elevatedLimit != nil && !elevatedLimit.Allowed {
			retry := retryAfterSeconds(elevatedLimit.ResetAt)
			decision.Blocked = true
			decision.RetryAfterSeconds = retry
			decision.ErrorCode = "PURCHASE_ELEVATED_RISK"
			decision.Message = "Purchase activity from this network is temporarily limited. Please try later."
			decision.Trigger = "banned_ip_signal"
			decision.RiskLevel = "high"
			_ = rl.appendPurchaseRiskEvent(ctx, PurchaseRiskEvent{
				Endpoint: endpoint,
				UserID:   userID,
				IP:       ip,
				Trigger:  decision.Trigger,
				Action:   "blocked",
				Detail:   fmt.Sprintf("banned_signals=%d retry_after=%ds", bannedIPSignals, retry),
			})
			return decision, nil
		}
		_ = rl.appendPurchaseRiskEvent(ctx, PurchaseRiskEvent{
			Endpoint: endpoint,
			UserID:   userID,
			IP:       ip,
			Trigger:  "banned_ip_signal",
			Action:   "allowed_elevated",
			Detail:   fmt.Sprintf("banned_signals=%d", bannedIPSignals),
		})
	}

	return decision, nil
}

func (rl *RateLimiter) ListPurchaseRiskEvents(ctx context.Context, limit int) ([]PurchaseRiskEvent, error) {
	if rl == nil || rl.redis == nil {
		return []PurchaseRiskEvent{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := rl.redis.LRange(ctx, purchaseRiskEventsKey, 0, int64(limit-1)).Result()
	if err != nil {
		if err == redis.Nil {
			return []PurchaseRiskEvent{}, nil
		}
		return nil, err
	}
	events := make([]PurchaseRiskEvent, 0, len(rows))
	for _, row := range rows {
		var evt PurchaseRiskEvent
		if unmarshalErr := json.Unmarshal([]byte(row), &evt); unmarshalErr != nil {
			continue
		}
		events = append(events, evt)
	}
	return events, nil
}
