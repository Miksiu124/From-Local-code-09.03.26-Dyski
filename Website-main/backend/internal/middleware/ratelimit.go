package middleware

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	redis *redis.Client
}

func NewRateLimiter(redis *redis.Client) *RateLimiter {
	return &RateLimiter{redis: redis}
}

type RateLimitResult struct {
	Allowed   bool
	Remaining int
	Limit     int
	ResetAt   int64
}

// Check implements a sliding window rate limiter using Redis
func (rl *RateLimiter) Check(key string, limit int, windowMs int64) (*RateLimitResult, error) {
	ctx := context.Background()
	now := time.Now().UnixMilli()
	windowStart := now - windowMs

	redisKey := fmt.Sprintf("ratelimit:%s", key)

	pipe := rl.redis.Pipeline()

	// Remove expired entries
	pipe.ZRemRangeByScore(ctx, redisKey, "0", strconv.FormatInt(windowStart, 10))

	// Count current entries
	countCmd := pipe.ZCard(ctx, redisKey)

	// Add current request
	pipe.ZAdd(ctx, redisKey, redis.Z{Score: float64(now), Member: now})

	// Set expiry on the key
	pipe.PExpire(ctx, redisKey, time.Duration(windowMs)*time.Millisecond)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return nil, err
	}

	count := countCmd.Val()
	allowed := count < int64(limit)
	remaining := int(int64(limit) - count - 1)
	if remaining < 0 {
		remaining = 0
	}

	resetAt := now + windowMs

	return &RateLimitResult{
		Allowed:   allowed,
		Remaining: remaining,
		Limit:     limit,
		ResetAt:   resetAt,
	}, nil
}
