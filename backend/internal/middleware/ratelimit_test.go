package middleware

import (
	"testing"
)

func TestRateLimitResult_Fields(t *testing.T) {
	r := &RateLimitResult{
		Allowed:   true,
		Remaining: 4,
		Limit:     5,
		ResetAt:   1000,
	}

	if !r.Allowed {
		t.Error("expected Allowed to be true")
	}
	if r.Remaining != 4 {
		t.Errorf("Remaining = %d, want 4", r.Remaining)
	}
	if r.Limit != 5 {
		t.Errorf("Limit = %d, want 5", r.Limit)
	}
}
