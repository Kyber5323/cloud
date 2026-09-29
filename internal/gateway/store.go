package gateway

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound is returned by lookups that must present one uniform failure to the browser: an
// unknown, expired, consumed, or revoked row is indistinguishable from the outside.
var ErrNotFound = errors.New("gateway record not found")

// Session is a resolved, currently valid browser session. It carries the normalized identity the
// Gateway signs into user credentials; it never carries the raw token.
type Session struct {
	ID        string
	Identity  VerifiedIdentity
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Attempt is one pending login attempt as stored; the digests are never returned.
type Attempt struct {
	ID       string
	Provider string
	ReturnTo string
}

// RevokeReason is the bounded set persisted with a revoked session. It is safe to expose in audit
// output and never carries request detail.
type RevokeReason string

// Revocation reasons accepted by the gateway_sessions constraint.
const (
	RevokeLogout         RevokeReason = "logout"
	RevokeIdentity       RevokeReason = "identity_revoked"
	RevokeAdministrative RevokeReason = "administrative"
)

// Store persists login attempts and browser sessions in PostgreSQL. It is the only authoritative
// store; validity is always decided by database state and database time.
type Store struct {
	pool *sql.DB
}

// NewStore wraps an injected pool. It performs no DDL; cloudctl migrate owns schema changes.
func NewStore(pool *sql.DB) (*Store, error) {
	if pool == nil {
		return nil, fmt.Errorf("database pool is required")
	}
	return &Store{pool: pool}, nil
}

// Digest is the fixed-size SHA-256 fingerprint stored instead of any browser-held secret.
func Digest(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// NewSecret returns 256 bits of randomness as URL-safe text suitable for a cookie or query value.
func NewSecret() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", fmt.Errorf("generate secret: %w", e)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// CreateAttempt records a pending login bound to the browser-held secret and provider state.
func (s *Store) CreateAttempt(ctx context.Context, secret, state, provider, returnTo string, ttl time.Duration) (string, error) {
	id := uuid.NewString()
	_, e := s.pool.ExecContext(ctx,
		"INSERT INTO gateway_login_attempts(id,secret_hash,state_hash,provider,return_to,expires_at) VALUES($1,$2,$3,$4,$5,now()+$6*interval '1 second')",
		id, Digest(secret), Digest(state), provider, returnTo, int64(ttl/time.Second))
	if e != nil {
		return "", fmt.Errorf("create login attempt: %w", e)
	}
	return id, nil
}

// LookupAttempt finds a live attempt for the browser secret and provider state. It takes no lock:
// the provider exchange that follows must run outside any transaction, and ConsumeAttempt re-checks
// the row under a lock before creating a session.
func (s *Store) LookupAttempt(ctx context.Context, secret, state, provider string) (Attempt, error) {
	var a Attempt
	e := s.pool.QueryRowContext(ctx,
		"SELECT id,provider,return_to FROM gateway_login_attempts WHERE secret_hash=$1 AND state_hash=$2 AND provider=$3 AND consumed_at IS NULL AND expires_at>clock_timestamp()",
		Digest(secret), Digest(state), provider).Scan(&a.ID, &a.Provider, &a.ReturnTo)
	if errors.Is(e, sql.ErrNoRows) {
		return Attempt{}, ErrNotFound
	}
	if e != nil {
		return Attempt{}, fmt.Errorf("lookup login attempt: %w", e)
	}
	return a, nil
}

// ConsumeAttempt marks the attempt consumed and creates the session in one transaction. Only one of
// two concurrent callbacks can win the row lock and pass the unconsumed check; the other observes
// ErrNotFound. The raw token is returned exactly once and never stored.
func (s *Store) ConsumeAttempt(ctx context.Context, attemptID string, identity VerifiedIdentity, ttl time.Duration) (token string, err error) {
	token, err = NewSecret()
	if err != nil {
		return "", err
	}
	tx, err := s.pool.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin consume attempt: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	result, err := tx.ExecContext(ctx,
		"UPDATE gateway_login_attempts SET consumed_at=clock_timestamp() WHERE id=(SELECT id FROM gateway_login_attempts WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE)",
		attemptID)
	if err != nil {
		return "", fmt.Errorf("consume login attempt: %w", err)
	}
	if n, e := result.RowsAffected(); e != nil || n != 1 {
		return "", ErrNotFound
	}
	if e := insertSession(ctx, tx, token, identity, ttl); e != nil {
		return "", e
	}
	if err = tx.Commit(); err != nil {
		return "", fmt.Errorf("commit login: %w", err)
	}
	return token, nil
}

func insertSession(ctx context.Context, tx *sql.Tx, token string, identity VerifiedIdentity, ttl time.Duration) error {
	var name sql.NullString
	if identity.DisplayName != "" {
		name = sql.NullString{String: identity.DisplayName, Valid: true}
	}
	_, e := tx.ExecContext(ctx,
		"INSERT INTO gateway_sessions(id,token_hash,source,subject,display_name,global_user_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second')",
		uuid.NewString(), Digest(token), identity.Source, identity.Subject, name, sql.NullString{String: identity.GlobalUserID, Valid: identity.GlobalUserID != ""}, int64(ttl/time.Second))
	if e != nil {
		return fmt.Errorf("create session: %w", e)
	}
	return nil
}

// Resolve returns the live session for a raw browser token. Reading never extends the absolute
// lifetime; expiry is decided by database time so every replica agrees.
func (s *Store) Resolve(ctx context.Context, token string) (Session, error) {
	var out Session
	var name, globalID sql.NullString
	e := s.pool.QueryRowContext(ctx,
		"SELECT id,source,subject,display_name,global_user_id,created_at,expires_at FROM gateway_sessions WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
		Digest(token)).Scan(&out.ID, &out.Identity.Source, &out.Identity.Subject, &name, &globalID, &out.CreatedAt, &out.ExpiresAt)
	if errors.Is(e, sql.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if e != nil {
		return Session{}, fmt.Errorf("resolve session: %w", e)
	}
	out.Identity.DisplayName = name.String
	out.Identity.GlobalUserID = globalID.String
	return out, nil
}

// Revoke ends the live session for a raw token. It is idempotent: unknown, expired, or already
// revoked tokens are not errors, so logout never leaks whether a token existed. Expired rows keep
// their expiry as the audit fact instead of gaining a revocation.
func (s *Store) Revoke(ctx context.Context, token string, reason RevokeReason) error {
	_, e := s.pool.ExecContext(ctx,
		"UPDATE gateway_sessions SET revoked_at=clock_timestamp(),revoked_reason=$2 WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
		Digest(token), string(reason))
	if e != nil {
		return fmt.Errorf("revoke session: %w", e)
	}
	return nil
}

// RevokeIdentity ends every live session of one external identity, for "log out everywhere" and
// incident response. It returns how many live sessions were revoked.
func (s *Store) RevokeIdentity(ctx context.Context, source, subject string, reason RevokeReason) (int64, error) {
	result, e := s.pool.ExecContext(ctx,
		"UPDATE gateway_sessions SET revoked_at=clock_timestamp(),revoked_reason=$3 WHERE source=$1 AND subject=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
		source, subject, string(reason))
	if e != nil {
		return 0, fmt.Errorf("revoke identity sessions: %w", e)
	}
	n, e := result.RowsAffected()
	if e != nil {
		return 0, fmt.Errorf("revoke identity sessions: %w", e)
	}
	return n, nil
}

// Cleanup deletes attempts and sessions whose audit window has passed, at most batch rows per table
// per call. Live sessions and unexpired attempts are never touched. It reports the rows deleted so
// the owner can decide whether to run another batch.
func (s *Store) Cleanup(ctx context.Context, retention time.Duration, batch int) (int64, error) {
	if batch <= 0 {
		return 0, fmt.Errorf("cleanup batch must be positive")
	}
	seconds := int64(retention / time.Second)
	var total int64
	for _, q := range []string{
		"DELETE FROM gateway_login_attempts WHERE id IN (SELECT id FROM gateway_login_attempts WHERE expires_at<clock_timestamp()-$1*interval '1 second' LIMIT $2)",
		"DELETE FROM gateway_sessions WHERE id IN (SELECT id FROM gateway_sessions WHERE LEAST(expires_at,revoked_at)<clock_timestamp()-$1*interval '1 second' LIMIT $2)",
	} {
		result, e := s.pool.ExecContext(ctx, q, seconds, batch)
		if e != nil {
			return total, fmt.Errorf("cleanup gateway rows: %w", e)
		}
		n, e := result.RowsAffected()
		if e != nil {
			return total, fmt.Errorf("cleanup gateway rows: %w", e)
		}
		total += n
	}
	return total, nil
}
