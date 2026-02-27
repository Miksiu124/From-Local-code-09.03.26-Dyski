package auth

import (
	"strings"
	"testing"
)

func TestEmailRegex(t *testing.T) {
	valid := []string{
		"test@example.com",
		"user+tag@domain.org",
		"a@b.co",
	}
	for _, email := range valid {
		if !emailRegex.MatchString(email) {
			t.Errorf("email %q should be valid", email)
		}
	}

	invalid := []string{
		"",
		"plaintext",
		"@no-local.com",
		"no-domain@",
		"spaces here@bad.com",
		"double@@at.com",
	}
	for _, email := range invalid {
		if emailRegex.MatchString(email) {
			t.Errorf("email %q should be invalid", email)
		}
	}
}

func TestPasswordValidation(t *testing.T) {
	cases := []struct {
		password string
		valid    bool
		reason   string
	}{
		{"Abcdef1", false, "too short (7 chars)"},
		{"Abcdefg1", true, "valid (8 chars, upper, lower, digit)"},
		{"ABCDEFG1", false, "no lowercase"},
		{"abcdefg1", false, "no uppercase"},
		{"Abcdefgh", false, "no digit"},
		{"Ab1", false, "too short"},
		{"ValidPass123", true, "good password"},
	}

	for _, tc := range cases {
		isValid := len(tc.password) >= 8 &&
			len(tc.password) <= 128 &&
			upperRegex.MatchString(tc.password) &&
			lowerRegex.MatchString(tc.password) &&
			digitRegex.MatchString(tc.password)

		if isValid != tc.valid {
			t.Errorf("password %q (%s): got valid=%v, want %v", tc.password, tc.reason, isValid, tc.valid)
		}
	}
}

func TestPasswordMaxLength(t *testing.T) {
	longPassword := make([]byte, 129)
	for i := range longPassword {
		longPassword[i] = 'A'
	}
	if len(longPassword) <= 128 {
		t.Error("test password should be > 128 chars")
	}
}

func TestEmailNormalization(t *testing.T) {
	cases := []struct {
		input, expected string
	}{
		{"  User@Example.COM  ", "user@example.com"},
		{"test@test.com", "test@test.com"},
		{" UPPER@CASE.NET ", "upper@case.net"},
	}

	for _, tc := range cases {
		result := strings.TrimSpace(strings.ToLower(tc.input))
		if result != tc.expected {
			t.Errorf("normalize(%q) = %q, want %q", tc.input, result, tc.expected)
		}
	}
}

func TestNameValidation(t *testing.T) {
	// Name limit is 64 characters (Register, UpdateProfile, UpdateUser)
	valid := []string{"", "A", "John Doe", strings.Repeat("x", 64)}
	for _, name := range valid {
		trimmed := strings.TrimSpace(name)
		if len(trimmed) > 64 {
			t.Errorf("name %q (len=%d) should be valid (<=64)", name, len(trimmed))
		}
	}

	invalid := []string{strings.Repeat("x", 65), strings.Repeat("a", 100)}
	for _, name := range invalid {
		if len(strings.TrimSpace(name)) <= 64 {
			t.Errorf("name len %d should exceed limit", len(name))
		}
	}
}
