package content

import (
	"testing"
)

func TestSanitizeFilename_ValidNames(t *testing.T) {
	cases := []struct {
		input, want string
	}{
		{"segment_000.ts", "segment_000.ts"},
		{"master.m3u8", "master.m3u8"},
		{"720p.m3u8", "720p.m3u8"},
		{"video.mp4", "video.mp4"},
		{"thumbnail.jpg", "thumbnail.jpg"},
	}
	for _, tc := range cases {
		got, err := sanitizeFilename(tc.input)
		if err != nil {
			t.Errorf("sanitizeFilename(%q) unexpected error: %v", tc.input, err)
		}
		if got != tc.want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestSanitizeFilename_PathTraversal(t *testing.T) {
	cases := []string{
		"../../../etc/passwd",
		"..\\..\\windows\\system32",
		"../secret.txt",
		"segment/../../../file",
		"foo/bar/baz.ts",
		"foo\\bar\\baz.ts",
		"..",
		"./file.ts",
	}
	for _, tc := range cases {
		_, err := sanitizeFilename(tc)
		if err == nil {
			t.Errorf("sanitizeFilename(%q) expected error, got nil", tc)
		}
	}
}

func TestSanitizeFilename_EmptyAndDot(t *testing.T) {
	cases := []string{
		"",
		".",
	}
	for _, tc := range cases {
		result, err := sanitizeFilename(tc)
		// Either returns error or the base name "." which we reject
		if err == nil && result == "." {
			t.Errorf("sanitizeFilename(%q) should reject '.'", tc)
		}
	}
}
