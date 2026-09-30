package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestObjectStoreUsesMountedCredentialsAndRejectsInvalidDeployment(t *testing.T) {
	dir := t.TempDir()
	access, secret := filepath.Join(dir, "access"), filepath.Join(dir, "secret")
	if err := os.WriteFile(access, []byte("fixture-access\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(secret, []byte("fixture-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfg := ObjectStoreConfig{Enabled: true, Endpoint: "http://private.invalid:9000", PublicEndpoint: "https://objects.invalid", Region: "us-east-1", Bucket: "revisions", PathStyle: true, AccessKeyIDFile: access, SecretAccessKeyFile: secret, UploadGrantTTL: 15 * time.Minute}
	opened, err := cfg.Open()
	if err != nil || opened == nil || opened.AccessKeyID != "fixture-access" || opened.SecretAccessKey != "fixture-secret" {
		t.Fatal("mounted credential configuration was not loaded")
	}
	cfg.Endpoint = "http://user:fixture-secret@private.invalid"
	if _, err = cfg.Open(); err == nil || strings.Contains(err.Error(), "fixture-secret") {
		t.Fatal("invalid private endpoint was accepted or disclosed a credential")
	}
	cfg.Enabled = false
	cfg.SecretAccessKeyFile = filepath.Join(dir, "missing")
	if disabled, err := cfg.Open(); err != nil || disabled != nil {
		t.Fatal("disabled storage attempted to load credentials")
	}
}
