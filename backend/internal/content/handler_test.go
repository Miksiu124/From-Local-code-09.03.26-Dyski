package content

import (
	"reflect"
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

func TestSanitizeSegmentPath_ValidPaths(t *testing.T) {
	cases := []struct {
		input, want string
	}{
		{"media_1080p_00000.ts", "media_1080p_00000.ts"},
		{"bds-VIDEO%2Fmedia_1080p_00000.ts", "bds-VIDEO/media_1080p_00000.ts"},
		{"subfolder%2Fsegment.ts", "subfolder/segment.ts"},
	}
	for _, tc := range cases {
		got, err := sanitizeSegmentPath(tc.input)
		if err != nil {
			t.Errorf("sanitizeSegmentPath(%q) unexpected error: %v", tc.input, err)
		}
		if got != tc.want {
			t.Errorf("sanitizeSegmentPath(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestSanitizeSegmentPath_RejectsPathTraversal(t *testing.T) {
	cases := []string{
		"..", "../secret.ts", "sub/../file.ts", "sub/..", "/absolute.ts",
		"sub%2F..%2Ffile.ts", "..%2Ffile.ts",
	}
	for _, tc := range cases {
		_, err := sanitizeSegmentPath(tc)
		if err == nil {
			t.Errorf("sanitizeSegmentPath(%q) expected error, got nil", tc)
		}
	}
}

func TestPlaylistObjectCandidates_masterPrefersFolderThenDB(t *testing.T) {
	folder := "models/x/abc_source/hls"
	dbPath := "models/x/abc_source/hls/old-master.m3u8"
	got := playlistObjectCandidates("master.m3u8", folder, true, strPtr(dbPath))
	if len(got) < 2 {
		t.Fatalf("expected multiple candidates, got %v", got)
	}
	if got[0] != folder+"/master.m3u8" {
		t.Errorf("first key = %q, want %q", got[0], folder+"/master.m3u8")
	}
	if got[len(got)-1] != dbPath {
		t.Errorf("last key (DB path) = %q, want %q", got[len(got)-1], dbPath)
	}
}

func TestPlaylistObjectCandidates_variantOnlyFolder(t *testing.T) {
	folder := "models/x/uid_source"
	got := playlistObjectCandidates("720p.m3u8", folder, true, strPtr("ignored-for-non-master"))
	want := []string{folder + "/720p.m3u8"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func strPtr(s string) *string { return &s }

func TestSyntheticHLSFolder(t *testing.T) {
	if got := syntheticHLSFolder("alinaxrose", "08gept328tlq3pcs27jp"); got != "alinaxrose/08gept328tlq3pcs27jp_source" {
		t.Fatalf("syntheticHLSFolder = %q", got)
	}
	if syntheticHLSFolder("", "x") != "" || syntheticHLSFolder("m", "") != "" {
		t.Fatal("expected empty for missing parts")
	}
}
