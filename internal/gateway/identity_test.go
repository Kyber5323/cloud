package gateway

import (
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeMatchesCloudByteLimits(t *testing.T) {
	longASCII := strings.Repeat("n", 255)
	// 100 three-byte runes are 300 bytes: Cloud counts bytes, so the name must shrink to 66 whole runes.
	cjk := strings.Repeat("名", 100)
	cases := []struct {
		name    string
		in      VerifiedIdentity
		want    VerifiedIdentity
		wantErr bool
	}{
		{"unchanged when within limits", VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: "Ray"}, VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: "Ray"}, false},
		{"long ascii name truncated to 200 bytes", VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: longASCII}, VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: longASCII[:200]}, false},
		{"multibyte name truncated on a rune boundary", VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: cjk}, VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: strings.Repeat("名", 66)}, false},
		{"invalid utf8 name dropped", VerifiedIdentity{Source: "github.com", Subject: "42", DisplayName: "bad\xff"}, VerifiedIdentity{Source: "github.com", Subject: "42"}, false},
		{"empty source rejected", VerifiedIdentity{Subject: "42"}, VerifiedIdentity{}, true},
		{"empty subject rejected", VerifiedIdentity{Source: "github.com"}, VerifiedIdentity{}, true},
		{"source over 128 bytes rejected", VerifiedIdentity{Source: strings.Repeat("s", 129), Subject: "42"}, VerifiedIdentity{}, true},
		{"subject over 512 bytes rejected", VerifiedIdentity{Source: "github.com", Subject: strings.Repeat("s", 513)}, VerifiedIdentity{}, true},
		{"Huawei global id accepted", VerifiedIdentity{Source: "huawei-corp", Subject: "uuid~1", GlobalUserID: "205045249610656"}, VerifiedIdentity{Source: "huawei-corp", Subject: "uuid~1", GlobalUserID: "205045249610656"}, false},
		{"non-decimal global id rejected", VerifiedIdentity{Source: "huawei-corp", Subject: "uuid~1", GlobalUserID: "w123"}, VerifiedIdentity{}, true},
	}
	for _, tc := range cases {
		got, e := Normalize(tc.in)
		if (e != nil) != tc.wantErr || got != tc.want {
			t.Errorf("%s: Normalize = (%+v,%v) want (%+v, err=%v)", tc.name, got, e, tc.want, tc.wantErr)
		}
		if e != nil && !errors.Is(e, ErrProviderRejected) {
			t.Errorf("%s: rejection must map to ErrProviderRejected, got %v", tc.name, e)
		}
		if len(got.DisplayName) > MaxDisplayNameLength || !utf8.ValidString(got.DisplayName) {
			t.Errorf("%s: display name %q violates the byte limit or UTF-8 validity", tc.name, got.DisplayName)
		}
	}
}
