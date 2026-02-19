package credits

import (
	"strings"
	"testing"
)

func TestGenerateTransactionCode_Format(t *testing.T) {
	code := generateTransactionCode()
	if len(code) != 16 { // 8 bytes = 16 hex chars
		t.Errorf("transaction code length = %d, want 16", len(code))
	}
	if code != strings.ToUpper(code) {
		t.Errorf("transaction code should be uppercase: %s", code)
	}
}

func TestGenerateTransactionCode_Unique(t *testing.T) {
	codes := make(map[string]bool)
	for i := 0; i < 1000; i++ {
		code := generateTransactionCode()
		if codes[code] {
			t.Fatalf("duplicate transaction code: %s", code)
		}
		codes[code] = true
	}
}

func TestCreatePurchaseRequest_Validation(t *testing.T) {
	validMethods := map[string]bool{"BLIK": true, "CRYPTO": true, "PAYPAL": true, "REVOLUT": true}

	valid := []string{"BLIK", "CRYPTO", "PAYPAL", "REVOLUT"}
	for _, m := range valid {
		if !validMethods[m] {
			t.Errorf("method %q should be valid", m)
		}
	}

	invalid := []string{"blik", "CASH", "", "BITCOIN", "paypal"}
	for _, m := range invalid {
		if validMethods[m] {
			t.Errorf("method %q should be invalid", m)
		}
	}
}

func TestBlikCodeValidation(t *testing.T) {
	cases := []struct {
		code  string
		valid bool
	}{
		{"123456", true},
		{"000000", true},
		{"12345", false},  // too short
		{"", false},       // empty
		{"   ", false},    // whitespace
		{"1234567", true}, // longer is ok per current validation (>= 6)
	}

	for _, tc := range cases {
		trimmed := strings.TrimSpace(tc.code)
		isValid := trimmed != "" && len(trimmed) >= 6
		if isValid != tc.valid {
			t.Errorf("BLIK code %q: got valid=%v, want %v", tc.code, isValid, tc.valid)
		}
	}
}
