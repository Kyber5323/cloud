package config

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

// TLS loads management files from deployment-owned paths. It never installs keys in a Workspace.
func (c *ControlConfig) TLS() (*tls.Config, error) {
	if c.CertificateFile == "" || c.PrivateKeyFile == "" || c.ClientCAFile == "" || c.ControllerIdentity == "" {
		return nil, fmt.Errorf("control management certificate, key, client CA and service identity are required")
	}
	pair, err := tls.LoadX509KeyPair(c.CertificateFile, c.PrivateKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load control certificate: %w", err)
	}
	pem, err := os.ReadFile(c.ClientCAFile)
	if err != nil {
		return nil, fmt.Errorf("load control client CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("invalid control client CA")
	}
	return &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{pair}, ClientCAs: roots, ClientAuth: tls.RequireAndVerifyClientCert}, nil
}
