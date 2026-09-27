// Package gateway implements the public authentication boundary in front of Cloud: external login
// orchestration, PostgreSQL-backed browser sessions, short-lived internal credential issuance, and
// the allowlisted reverse proxy. Cloud remains the only authority for users, membership, and
// resource authorization; nothing here interprets business state.
package gateway

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"
)

// Field limits mirror Cloud's identity contract (internal/core/store.go identity()) so a
// VerifiedIdentity never reaches Cloud with a length it would reject as invalid_identity.
const (
	MaxSourceLength      = 128
	MaxSubjectLength     = 512
	MaxDisplayNameLength = 200
)

// VerifiedIdentity is the provider-neutral result of one successful external authentication. It
// proves who the external provider says the browser is; it does not prove that Cloud knows, enables,
// or authorizes that user.
type VerifiedIdentity struct {
	Source      string
	Subject     string
	DisplayName string
	// GlobalUserID is the verified Huawei directory key, never an employee number.
	GlobalUserID string
}

// ErrProviderRejected reports an external provider answer that cannot yield an identity: a rejected
// code, a malformed user document, or a missing stable ID. Callers map it to the uniform login
// failure without exposing provider detail.
var ErrProviderRejected = errors.New("provider rejected the authentication")

// AuthorizationRequest carries the orchestration-owned parameters an Authenticator must bind into
// the provider redirect. Adapters never generate state or PKCE material themselves.
type AuthorizationRequest struct {
	State         string
	CodeChallenge string
	CallbackURL   string
}

// Authenticator adapts one external authentication protocol. Implementations interpret provider
// codes, tokens, and user documents; they cannot grant any Ora permission.
type Authenticator interface {
	// AuthorizationURL builds the provider redirect for the given orchestration parameters.
	AuthorizationURL(request AuthorizationRequest) (string, error)
	// Exchange redeems the callback code with the PKCE verifier and returns the verified identity.
	// It must not be called while a database transaction or lock is held.
	Exchange(ctx context.Context, code, codeVerifier, callbackURL string) (VerifiedIdentity, error)
}

// Normalize enforces Cloud's field limits on an adapter result. Cloud measures these limits in
// bytes, so the same unit applies here. Source and subject are identity keys and must fit
// unchanged; a display name is non-authoritative and is truncated on a rune boundary so a long
// provider name never turns into an unexplained Cloud 401.
func Normalize(identity VerifiedIdentity) (VerifiedIdentity, error) {
	if identity.Source == "" || len(identity.Source) > MaxSourceLength || !utf8.ValidString(identity.Source) {
		return VerifiedIdentity{}, fmt.Errorf("%w: invalid source", ErrProviderRejected)
	}
	if identity.Subject == "" || len(identity.Subject) > MaxSubjectLength || !utf8.ValidString(identity.Subject) {
		return VerifiedIdentity{}, fmt.Errorf("%w: invalid subject", ErrProviderRejected)
	}
	if !utf8.ValidString(identity.DisplayName) {
		identity.DisplayName = ""
	}
	identity.DisplayName = truncateBytes(identity.DisplayName, MaxDisplayNameLength)
	if identity.GlobalUserID != "" {
		if identity.Source != "huawei-corp" || len(identity.GlobalUserID) > 20 {
			return VerifiedIdentity{}, fmt.Errorf("%w: invalid global user id", ErrProviderRejected)
		}
		for _, digit := range identity.GlobalUserID {
			if digit < '0' || digit > '9' {
				return VerifiedIdentity{}, fmt.Errorf("%w: invalid global user id", ErrProviderRejected)
			}
		}
	}
	return identity, nil
}

// truncateBytes cuts s to at most limit bytes without splitting a UTF-8 sequence.
func truncateBytes(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}
