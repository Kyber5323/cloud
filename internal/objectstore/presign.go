// Package objectstore signs short-lived upload URLs for the object store Cloud is configured with.
// Signing is local cryptography: it does not call the store. The resulting URL is a bearer
// credential and must not be written to the database or to logs.
package objectstore

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Config is the in-memory view of Cloud's object store. Credential values live only in this
// process; callers load them from files and never persist them.
type Config struct {
	Endpoint        string
	PublicEndpoint  string
	Region          string
	Bucket          string
	PathStyle       bool
	AccessKeyID     string
	SecretAccessKey string
	UploadGrantTTL  time.Duration
}

// Grant is one presigned PUT. Headers must be sent unchanged, apart from the checksum header the
// uploader adds itself.
type Grant struct {
	URL     string
	Method  string
	Headers map[string]string
	Expires time.Time
}

// PresignPUT signs a single-object PUT that expires after the configured grant TTL.
// The key must be the object key Cloud already fixed for this delivery attempt.
func PresignPUT(cfg *Config, key string, now time.Time) (Grant, error) {
	if cfg == nil || cfg.Endpoint == "" || cfg.Region == "" || cfg.Bucket == "" || cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" {
		return Grant{}, fmt.Errorf("object store is not configured")
	}
	if !validKey(key) {
		return Grant{}, fmt.Errorf("invalid object key")
	}
	ttl := cfg.UploadGrantTTL
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	base := cfg.Endpoint
	if cfg.PublicEndpoint != "" {
		base = cfg.PublicEndpoint
	}
	endpoint, err := url.Parse(base)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return Grant{}, fmt.Errorf("invalid object store endpoint")
	}
	now = now.UTC()
	amzDate := now.Format("20060102T150405Z")
	scopeDate := now.Format("20060102")
	credential := cfg.AccessKeyID + "/" + scopeDate + "/" + cfg.Region + "/s3/aws4_request"
	query := url.Values{}
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", credential)
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", fmt.Sprintf("%d", int(ttl.Seconds())))
	query.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := query.Encode()
	escaped := escapeKey(key)
	canonicalURI := "/" + escaped
	if cfg.PathStyle {
		canonicalURI = "/" + url.PathEscape(cfg.Bucket) + "/" + escaped
	}
	host := endpoint.Host
	canonical := strings.Join([]string{
		"PUT",
		canonicalURI,
		canonicalQuery,
		"host:" + host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	scope := scopeDate + "/" + cfg.Region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hexSHA256(canonical)
	signature := hex.EncodeToString(hmacSHA256(signingKey(cfg.SecretAccessKey, scopeDate, cfg.Region), stringToSign))
	query.Set("X-Amz-Signature", signature)
	signed := *endpoint
	signed.Path = canonicalURI
	signed.RawQuery = query.Encode()
	return Grant{
		URL:     signed.String(),
		Method:  "PUT",
		Headers: map[string]string{"host": host},
		Expires: now.Add(ttl),
	}, nil
}

func validKey(key string) bool {
	return key != "" && !strings.HasPrefix(key, "/") && !strings.Contains(key, "..") && !strings.Contains(key, "\\") && !strings.Contains(key, " ")
}

func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func hexSHA256(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func signingKey(secret, date, region string) []byte {
	return hmacSHA256(hmacSHA256(hmacSHA256(hmacSHA256([]byte("AWS4"+secret), date), region), "s3"), "aws4_request")
}
