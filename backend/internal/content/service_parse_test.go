package content

import "testing"

func TestParseSourceSegmentUID(t *testing.T) {
	tests := []struct {
		seg  string
		want string
		ok   bool
	}{
		{"abc123_source", "abc123", true},
		{"0hjmnxvkepelwvltq8ioq_source (1)", "0hjmnxvkepelwvltq8ioq", true},
		{"x_source (12)", "x", true},
		{"_source", "", false},
		{"nope", "", false},
		{"abc_source (x)", "", false},
		{"abc_source (1", "", false},
		{"vid_source - Copy", "vid", true},
		{"vid_source - Copy (2)", "vid", true},
		{"vid_source - kopia", "vid", true},
		{"vid_source - kopia (3)", "vid", true},
	}
	for _, tt := range tests {
		got, ok := parseSourceSegmentUID(tt.seg)
		if ok != tt.ok || got != tt.want {
			t.Errorf("parseSourceSegmentUID(%q) = (%q, %v), want (%q, %v)", tt.seg, got, ok, tt.want, tt.ok)
		}
	}
}

func TestParseVideoM3U8Key(t *testing.T) {
	tests := []struct {
		key     string
		wantUID string
		wantHLS string
		ok      bool
	}{
		{"models/foo/abc_source/master.m3u8", "abc", "models/foo/abc_source", true},
		{"models/foo/abc_source (1)/master.m3u8", "abc", "models/foo/abc_source (1)", true},
		{"models/foo/abc_source/hls/master.m3u8", "abc", "models/foo/abc_source/hls", true},
		{"models/foo/abc_source (1)/hls/master.m3u8", "abc", "models/foo/abc_source (1)/hls", true},
		{"models/foo/abc_source - Copy/master.m3u8", "abc", "models/foo/abc_source - Copy", true},
		{"models/foo/notvideo/master.m3u8", "", "", false},
		{"models/foo/abc_source/readme.txt", "", "", false},
	}
	for _, tt := range tests {
		uid, hls, ok := parseVideoM3U8Key(tt.key)
		if ok != tt.ok || uid != tt.wantUID || hls != tt.wantHLS {
			t.Errorf("parseVideoM3U8Key(%q) = (%q, %q, %v), want (%q, %q, %v)", tt.key, uid, hls, ok, tt.wantUID, tt.wantHLS, tt.ok)
		}
	}
}
