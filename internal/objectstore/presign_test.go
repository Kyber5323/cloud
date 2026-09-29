package objectstore

import (
	"strings"
	"testing"
	"time"
)

func TestPresignPUTBindsTheKeyAndStaysLocal(t *testing.T) {
	cfg := Config{
		Endpoint: "http://127.0.0.1:9000", Region: "us-east-1", Bucket: "revisions", PathStyle: true,
		AccessKeyID: "test-access", SecretAccessKey: "test-secret", UploadGrantTTL: 15 * time.Minute,
	}
	now := time.Date(2026, 9, 30, 1, 2, 3, 0, time.UTC)
	grant, err := PresignPUT(&cfg, "revisions/tenant/run/work/revision.bundle", now)
	if err != nil {
		t.Fatal(err)
	}
	if grant.Method != "PUT" || !grant.Expires.Equal(now.Add(15*time.Minute)) {
		t.Fatalf("grant meta: %+v", grant)
	}
	if !strings.Contains(grant.URL, "/revisions/revisions/tenant/run/work/revision.bundle") || !strings.Contains(grant.URL, "X-Amz-Signature=") {
		t.Fatalf("url = %s", grant.URL)
	}
	if grant.Headers["host"] != "127.0.0.1:9000" {
		t.Fatalf("headers = %v", grant.Headers)
	}
	other, err := PresignPUT(&cfg, "revisions/tenant/run/work/session.jsonl", now)
	if err != nil {
		t.Fatal(err)
	}
	if other.URL == grant.URL {
		t.Fatal("different keys produced the same url")
	}
	if _, err = PresignPUT(&Config{}, "revisions/a", now); err == nil {
		t.Fatal("unconfigured store signed a url")
	}
	if _, err = PresignPUT(&cfg, "../escape", now); err == nil {
		t.Fatal("escaped key was signed")
	}
}
