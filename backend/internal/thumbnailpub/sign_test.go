package thumbnailpub

import (
	"strings"
	"testing"
	"time"
)

func TestSignMediaURLToken_Deterministic(t *testing.T) {
	const secret = "test-media-cdn-signing-secret-min-32-chars!!"
	const key = "folder/vid_source/segment_000.ts"
	const exp int64 = 1700000000
	got := SignMediaURLToken(secret, key, exp)
	if len(got) != 64 {
		t.Fatalf("token len = %d, want 64 hex chars", len(got))
	}
	if !VerifyMediaURLToken(secret, key, exp, got) {
		t.Fatal("verify own signature failed")
	}
	if VerifyMediaURLToken(secret, key, exp+1, got) {
		t.Fatal("wrong expires accepted")
	}
	if VerifyMediaURLToken(secret, key+"x", exp, got) {
		t.Fatal("wrong key accepted")
	}
}

func TestPublicSignedObjectURL_IncludesQuery(t *testing.T) {
	secret := "test-media-cdn-signing-secret-min-32-chars!!"
	u := PublicSignedObjectURL("https://cdn.example.com", "a/b/c.ts", secret, time.Hour)
	if u == "" {
		t.Fatal("empty URL")
	}
	if !strings.Contains(u, "token=") || !strings.Contains(u, "expires=") {
		t.Fatalf("missing query: %q", u)
	}
}
