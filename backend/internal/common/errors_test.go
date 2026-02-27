package common

import (
	"testing"
)

func TestIsValidUUID(t *testing.T) {
	valid := []string{
		"550e8400-e29b-41d4-a716-446655440000",
		"6ba7b810-9dad-11d1-80b4-00c04fd430c8",
		"00000000-0000-0000-0000-000000000000",
		"FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
		"01234567-89ab-cdef-0123-456789abcdef",
	}
	for _, u := range valid {
		if !IsValidUUID(u) {
			t.Errorf("IsValidUUID(%q) = false, want true", u)
		}
	}
}

func TestIsValidUUID_Invalid(t *testing.T) {
	invalid := []string{
		"",
		"not-a-uuid",
		"550e8400e29b41d4a716446655440000",     // no hyphens
		"550e8400-e29b-41d4-a716-44665544000",  // too short
		"550e8400-e29b-41d4-a716-4466554400000", // too long
		"550e8400-e29b-41d4-a716-44665544000g",  // invalid char
		"550e8400-e29b-41d4-a716-44665544000 ",  // trailing space
		"; DROP TABLE users;--",
	}
	for _, u := range invalid {
		if IsValidUUID(u) {
			t.Errorf("IsValidUUID(%q) = true, want false", u)
		}
	}
}
