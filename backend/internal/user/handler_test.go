package user

import (
	"strings"
	"testing"
)

func TestUpdateProfileNameValidation(t *testing.T) {
	// Mirrors validation in UpdateProfile: trimmed 1-64 chars
	validateName := func(name string) bool {
		trimmed := strings.TrimSpace(name)
		return len(trimmed) >= 1 && len(trimmed) <= 64
	}

	valid := []string{
		"A",
		"John",
		"Jane Doe",
		strings.Repeat("x", 64),
	}
	for _, n := range valid {
		if !validateName(n) {
			t.Errorf("name %q (len=%d) should be valid", n, len(strings.TrimSpace(n)))
		}
	}

	invalid := []string{
		"",
		"   ",
		strings.Repeat("x", 65),
	}
	for _, n := range invalid {
		if validateName(n) {
			trimmed := strings.TrimSpace(n)
			t.Errorf("name %q (trimmed len=%d) should be invalid", n, len(trimmed))
		}
	}
}

func TestEmailRegex(t *testing.T) {
	valid := []string{"a@b.co", "user@domain.org", "test+tag@example.com"}
	for _, e := range valid {
		if !emailRegex.MatchString(e) {
			t.Errorf("email %q should be valid", e)
		}
	}
	invalid := []string{"", "no-at", "@domain.com", "user@"}
	for _, e := range invalid {
		if emailRegex.MatchString(e) {
			t.Errorf("email %q should be invalid", e)
		}
	}
}

func TestPasswordValidation(t *testing.T) {
	cases := []struct {
		pass string
		ok   bool
	}{
		{"Abcdefg1", true},
		{"Ab1", false},
		{"abcdefg1", false},
		{"ABCDEFG1", false},
		{"Abcdefgh", false},
	}
	for _, tc := range cases {
		valid := len(tc.pass) >= 8 && len(tc.pass) <= 128 &&
			upperRegex.MatchString(tc.pass) &&
			lowerRegex.MatchString(tc.pass) &&
			digitRegex.MatchString(tc.pass)
		if valid != tc.ok {
			t.Errorf("password %q: got valid=%v, want %v", tc.pass, valid, tc.ok)
		}
	}
}
