package content

import (
	"strings"
	"testing"
	"time"
)

const testSecret = "test-streaming-secret-key-1234"

func TestGenerateStreamingToken_NotEmpty(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	if token == "" {
		t.Fatal("generated token is empty")
	}
}

func TestGenerateStreamingToken_Format(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		t.Fatalf("token has %d parts, want 2 (expiry.signature)", len(parts))
	}
	if len(parts[1]) != 64 { // SHA256 hex = 64 chars
		t.Errorf("signature length = %d, want 64", len(parts[1]))
	}
}

func TestValidateStreamingToken_ValidToken(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	if !ValidateStreamingToken(testSecret, token, "user-1", "content-1", "segment_000.ts") {
		t.Fatal("valid token was rejected")
	}
}

func TestValidateStreamingToken_ExpiredToken(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", -1)
	// Token with -1 TTL expires immediately
	time.Sleep(2 * time.Second)
	if ValidateStreamingToken(testSecret, token, "user-1", "content-1", "segment_000.ts") {
		t.Fatal("expired token was accepted")
	}
}

func TestValidateStreamingToken_WrongUser(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	if ValidateStreamingToken(testSecret, token, "user-2", "content-1", "segment_000.ts") {
		t.Fatal("token with wrong user was accepted")
	}
}

func TestValidateStreamingToken_WrongContent(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	if ValidateStreamingToken(testSecret, token, "user-1", "content-2", "segment_000.ts") {
		t.Fatal("token with wrong content was accepted")
	}
}

func TestValidateStreamingToken_WrongSegment(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	if ValidateStreamingToken(testSecret, token, "user-1", "content-1", "segment_001.ts") {
		t.Fatal("token with wrong segment was accepted")
	}
}

func TestValidateStreamingToken_TamperedSignature(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "segment_000.ts", 3600)
	// Flip a character in the signature
	tampered := token[:len(token)-1] + "X"
	if ValidateStreamingToken(testSecret, tampered, "user-1", "content-1", "segment_000.ts") {
		t.Fatal("tampered token was accepted")
	}
}

func TestValidateStreamingToken_WrongSecret(t *testing.T) {
	token := GenerateStreamingToken(testSecret, "user-1", "content-1", "seg.ts", 3600)
	if ValidateStreamingToken("wrong-secret", token, "user-1", "content-1", "seg.ts") {
		t.Fatal("token signed with different secret was accepted")
	}
}

func TestValidateStreamingToken_MalformedToken(t *testing.T) {
	cases := []string{
		"",
		"no-dot-here",
		".only-sig",
		"not-a-number.abcdef",
	}
	for _, tc := range cases {
		if ValidateStreamingToken(testSecret, tc, "u", "c", "s") {
			t.Errorf("malformed token %q was accepted", tc)
		}
	}
}

func TestRewritePlaylist_SegmentsRewritten(t *testing.T) {
	playlist := `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment_000.ts
#EXTINF:10.0,
segment_001.ts
#EXT-X-ENDLIST`

	result := RewritePlaylist(playlist, "https://example.com/api", "user-1", "content-1", testSecret, 3600)

	lines := strings.Split(result, "\n")
	segmentCount := 0
	for _, line := range lines {
		if strings.Contains(line, "segment_") && strings.Contains(line, "token=") {
			segmentCount++
			if !strings.HasPrefix(line, "https://example.com/api/content/content-1/segment/") {
				t.Errorf("unexpected segment URL: %s", line)
			}
			if !strings.Contains(line, "uid=user-1") {
				t.Errorf("missing uid in segment URL: %s", line)
			}
		}
	}
	if segmentCount != 2 {
		t.Errorf("expected 2 rewritten segments, got %d", segmentCount)
	}
}

func TestRewritePlaylist_VariantPlaylistRewritten(t *testing.T) {
	playlist := `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000
480p.m3u8`

	result := RewritePlaylist(playlist, "https://example.com/api", "user-1", "content-1", testSecret, 3600)

	if !strings.Contains(result, "/playlist/720p.m3u8?token=") {
		t.Error("720p variant not rewritten")
	}
	if !strings.Contains(result, "/playlist/480p.m3u8?token=") {
		t.Error("480p variant not rewritten")
	}
}

func TestRewritePlaylist_CommentsPreserved(t *testing.T) {
	playlist := `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-ENDLIST`

	result := RewritePlaylist(playlist, "https://example.com/api", "u", "c", testSecret, 3600)
	if !strings.Contains(result, "#EXTM3U") {
		t.Error("#EXTM3U comment not preserved")
	}
	if !strings.Contains(result, "#EXT-X-ENDLIST") {
		t.Error("#EXT-X-ENDLIST comment not preserved")
	}
}
