package thumbnailpub

import "testing"

func TestSanitizeR2ObjectKey(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"", ""},
		{"  ", ""},
		{"ok/path.webp", "ok/path.webp"},
		{"../etc/passwd", ""},
		{"/abs", ""},
		{"http://x", ""},
	}
	for _, tt := range tests {
		if g := SanitizeR2ObjectKey(tt.in); g != tt.want {
			t.Errorf("SanitizeR2ObjectKey(%q) = %q, want %q", tt.in, g, tt.want)
		}
	}
}

func TestPublicThumbnailURL(t *testing.T) {
	thumb := "folder/a_thumb.webp"
	u := PublicThumbnailURL("https://files.example.com", &thumb, nil)
	if want := "https://files.example.com/folder/a_thumb.webp"; u != want {
		t.Fatalf("got %q want %q", u, want)
	}
	if PublicThumbnailURL("", &thumb, nil) != "" {
		t.Fatal("empty base should yield empty URL")
	}
}

func TestPublicObjectURL(t *testing.T) {
	if got := PublicObjectURL("", "a/b.ts"); got != "" {
		t.Fatalf("empty base: got %q", got)
	}
	if got := PublicObjectURL("https://cdn.example/", "../x"); got != "" {
		t.Fatalf("unsafe key: got %q", got)
	}
	got := PublicObjectURL("https://files.example.com", "model/uuid_source/seg 1.ts")
	want := "https://files.example.com/model/uuid_source/seg%201.ts"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPrimaryThumbnailObjectKey_HLSFallback(t *testing.T) {
	hls := "model/uuid_source"
	k := PrimaryThumbnailObjectKey(nil, &hls)
	want := "model/uuid_source_thumbnail.webp"
	if k != want {
		t.Fatalf("got %q want %q", k, want)
	}
}
