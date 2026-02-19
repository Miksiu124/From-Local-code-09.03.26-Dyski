package database

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

func NewRedisClient(ctx context.Context, redisURL string) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse Redis URL: %w", err)
	}

	opts.PoolSize = 10
	opts.MinIdleConns = 2

	client := redis.NewClient(opts)

	// Verify connection
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("unable to ping Redis: %w", err)
	}

	return client, nil
}
