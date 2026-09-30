package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/wanglongan587/cloud/internal/objectstore"
)

// ObjectStoreConfig contains deployment references; credentials are read only into process memory.
// Disabling this optional capability leaves upload-grant requests explicitly unavailable.
type ObjectStoreConfig struct {
	Enabled             bool          `mapstructure:"enabled"`
	Endpoint            string        `mapstructure:"endpoint"`
	PublicEndpoint      string        `mapstructure:"public_endpoint"`
	Region              string        `mapstructure:"region"`
	Bucket              string        `mapstructure:"bucket"`
	PathStyle           bool          `mapstructure:"path_style"`
	AccessKeyIDFile     string        `mapstructure:"access_key_id_file"`
	SecretAccessKeyFile string        `mapstructure:"secret_access_key_file"`
	UploadGrantTTL      time.Duration `mapstructure:"upload_grant_ttl"`
}

// Open loads the separately mounted credential files and validates both private/public endpoints.
// It performs no network calls and returns no credential values in diagnostics.
func (c *ObjectStoreConfig) Open() (*objectstore.Config, error) {
	if !c.Enabled {
		return nil, nil
	}
	if c.UploadGrantTTL < time.Second || c.UploadGrantTTL > 7*24*time.Hour {
		return nil, fmt.Errorf("object_store.upload_grant_ttl must be between 1s and 168h")
	}
	access, err := os.ReadFile(c.AccessKeyIDFile)
	if err != nil {
		return nil, fmt.Errorf("cannot read object_store access key file")
	}
	secret, err := os.ReadFile(c.SecretAccessKeyFile)
	if err != nil {
		return nil, fmt.Errorf("cannot read object_store secret key file")
	}
	out := &objectstore.Config{Endpoint: c.Endpoint, PublicEndpoint: c.PublicEndpoint, Region: c.Region, Bucket: c.Bucket, PathStyle: c.PathStyle, AccessKeyID: strings.TrimSpace(string(access)), SecretAccessKey: strings.TrimSpace(string(secret)), UploadGrantTTL: c.UploadGrantTTL}
	private := *out
	private.PublicEndpoint = ""
	for _, cfg := range []*objectstore.Config{&private, out} {
		if _, err := objectstore.PresignPUT(cfg, "configuration-validation", time.Now()); err != nil {
			return nil, fmt.Errorf("invalid object_store endpoint, bucket, region or credential configuration")
		}
	}
	return out, nil
}
