package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadParsesDurations(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	contents := []byte("server:\n  read_timeout: 10s\n  write_timeout: 15s\ndatabase:\n  conn_max_lifetime: 1h\ncontrol:\n  grpc_addr: 127.0.0.1:8082\n")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server.ReadTimeout != 10*time.Second || cfg.Server.WriteTimeout != 15*time.Second || cfg.Database.ConnMaxLifetime != time.Hour {
		t.Fatalf("durations were not parsed: %+v %+v", cfg.Server, cfg.Database)
	}
	if cfg.Control.GRPCAddr != "127.0.0.1:8082" {
		t.Fatalf("control address was not parsed: %+v", cfg.Control)
	}
}

// The control listener has no safe default address: a Controller must be pointed at it explicitly.
func TestLoadRequiresControlAddress(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	contents := []byte("server:\n  read_timeout: 10s\n  write_timeout: 15s\ndatabase:\n  conn_max_lifetime: 1h\n")
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("missing control.grpc_addr must fail configuration loading")
	}
}

func TestEnvironmentOverridesKeysAbsentFromTheFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	// No auth or control section and no database.dsn: all must still arrive from the environment.
	yaml := "server: {port: 8080, mode: test, read_timeout: 5s, write_timeout: 5s}\n" +
		"logger: {level: info, filename: " + filepath.ToSlash(filepath.Join(dir, "app.log")) + ", max_size: 1, max_backups: 1, max_age: 1, compress: false, enable_console: false}\n" +
		"database: {driver: postgres, max_idle_conns: 1, max_open_conns: 1, conn_max_lifetime: 1h}\n"
	if e := os.WriteFile(path, []byte(yaml), 0o600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("CLOUD_DATABASE_DSN", "host=env-only")
	t.Setenv("CLOUD_AUTH_AUDIENCE", "ora-cloud")
	t.Setenv("CLOUD_CONTROL_GRPC_ADDR", "127.0.0.1:8082")
	cfg, e := Load(path)
	if e != nil {
		t.Fatal(e)
	}
	if cfg.Database.DSN != "host=env-only" || cfg.Auth.Audience != "ora-cloud" || cfg.Control.GRPCAddr != "127.0.0.1:8082" {
		t.Fatalf("environment must supply keys absent from the file: %+v", cfg)
	}
}
