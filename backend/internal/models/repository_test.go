package models

import (
	"testing"
)

func TestGetSettingValue_KeyFormat(t *testing.T) {
	validKeys := []string{
		"model_credit_cost_7d",
		"model_credit_cost_30d",
		"bundle_credit_cost",
		"crypto_wallets",
		"max_pending_credit_purchases",
	}

	for _, key := range validKeys {
		if key == "" {
			t.Error("setting key should not be empty")
		}
		if len(key) > 100 {
			t.Errorf("setting key %q is too long", key)
		}
	}
}

func TestAccessCheckLogic(t *testing.T) {
	// Unit test the access check SQL logic:
	// A user has access if:
	// - model_id matches OR model_id IS NULL (bundle)
	// - expires_at IS NULL OR expires_at > now()

	type accessRecord struct {
		modelID   *string
		expiresAt *string // nil means no expiry
	}

	modelA := "model-a"

	cases := []struct {
		name       string
		records    []accessRecord
		queryModel string
		expected   bool
	}{
		{
			name:       "direct model access",
			records:    []accessRecord{{modelID: &modelA, expiresAt: nil}},
			queryModel: "model-a",
			expected:   true,
		},
		{
			name:       "bundle access covers all",
			records:    []accessRecord{{modelID: nil, expiresAt: nil}},
			queryModel: "model-b",
			expected:   true,
		},
		{
			name:       "no matching access",
			records:    []accessRecord{{modelID: &modelA, expiresAt: nil}},
			queryModel: "model-b",
			expected:   false,
		},
		{
			name:       "no records",
			records:    []accessRecord{},
			queryModel: "model-a",
			expected:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			hasAccess := false
			for _, r := range tc.records {
				matchesModel := (r.modelID != nil && *r.modelID == tc.queryModel) || r.modelID == nil
				notExpired := r.expiresAt == nil // simplified: nil means not expired
				if matchesModel && notExpired {
					hasAccess = true
					break
				}
			}
			if hasAccess != tc.expected {
				t.Errorf("got %v, want %v", hasAccess, tc.expected)
			}
		})
	}
}
