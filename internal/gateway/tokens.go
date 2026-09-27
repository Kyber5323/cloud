package gateway

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/wanglongan587/cloud/internal/core"
)

// MaxCredentialLifetime is Cloud's verifier ceiling; the issuer never exceeds it regardless of the
// far longer browser session lifetime.
const MaxCredentialLifetime = 5 * time.Minute

// SigningKey pairs a key ID with the Ed25519 private key registered under that ID at Cloud.
type SigningKey struct {
	ID  string
	Key ed25519.PrivateKey
}

// Issuer signs the two internal credentials Cloud verifies per request. Service and user
// credentials use separate keys because Cloud binds each trusted key to one purpose.
type Issuer struct {
	issuer, audience, serviceSubject string
	service, user                    SigningKey
	lifetime                         time.Duration
	now                              func() time.Time
}

// Credentials is one request's pair of freshly signed internal tokens.
type Credentials struct {
	Service string
	User    string
}

// NewIssuer validates the trust configuration once so signing cannot partially fail later.
func NewIssuer(issuer, audience, serviceSubject string, service, user SigningKey, lifetime time.Duration, now func() time.Time) (*Issuer, error) {
	if issuer == "" || audience == "" || serviceSubject == "" {
		return nil, fmt.Errorf("token issuer, audience and service subject are required")
	}
	if service.ID == "" || user.ID == "" || len(service.Key) != ed25519.PrivateKeySize || len(user.Key) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("service and user signing keys with key IDs are required")
	}
	if service.ID == user.ID || service.Key.Equal(user.Key) {
		return nil, fmt.Errorf("service and user signing keys must be distinct")
	}
	if lifetime <= 0 || lifetime > MaxCredentialLifetime {
		return nil, fmt.Errorf("token lifetime must be positive and at most %s", MaxCredentialLifetime)
	}
	if now == nil {
		now = time.Now
	}
	return &Issuer{issuer: issuer, audience: audience, serviceSubject: serviceSubject, service: service, user: user, lifetime: lifetime, now: now}, nil
}

// ServiceSubject is the stable caller identity bound into every user credential.
func (i *Issuer) ServiceSubject() string { return i.serviceSubject }

// Issue signs a service credential and a user credential for one resolved session. The user
// credential's caller equals this issuer's service subject so Cloud's caller binding holds.
func (i *Issuer) Issue(identity VerifiedIdentity) (Credentials, error) {
	now := i.now()
	registered := func(subject string) jwt.RegisteredClaims {
		return jwt.RegisteredClaims{Issuer: i.issuer, Subject: subject, Audience: jwt.ClaimStrings{i.audience}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(i.lifetime))}
	}
	service, e := sign(i.service, &core.Claims{RegisteredClaims: registered(i.serviceSubject), Kind: "service", Role: "gateway"})
	if e != nil {
		return Credentials{}, e
	}
	user, e := sign(i.user, &core.Claims{RegisteredClaims: registered(identity.Subject), Kind: "user", Caller: i.serviceSubject, Source: identity.Source, DisplayName: identity.DisplayName, GlobalUserID: identity.GlobalUserID})
	if e != nil {
		return Credentials{}, e
	}
	return Credentials{Service: service, User: user}, nil
}

func sign(key SigningKey, claims *core.Claims) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = key.ID
	raw, e := t.SignedString(key.Key)
	if e != nil {
		return "", fmt.Errorf("sign %s credential: %w", claims.Kind, e)
	}
	return raw, nil
}

// LoadPrivateKey reads a PKCS#8 "PRIVATE KEY" PEM holding an Ed25519 key. The key material stays in
// process memory only; it is never logged or persisted by the Gateway.
func LoadPrivateKey(path string) (ed25519.PrivateKey, error) {
	b, e := os.ReadFile(path) // #nosec G304 -- operator-configured key path.
	if e != nil {
		return nil, fmt.Errorf("read private key: %w", e)
	}
	block, _ := pem.Decode(b)
	if block == nil || block.Type != "PRIVATE KEY" {
		return nil, fmt.Errorf("private key %s: PKCS#8 PRIVATE KEY PEM required", path)
	}
	v, e := x509.ParsePKCS8PrivateKey(block.Bytes)
	if e != nil {
		return nil, fmt.Errorf("parse private key %s: %w", path, e)
	}
	key, ok := v.(ed25519.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("private key %s: Ed25519 key required", path)
	}
	return key, nil
}
