package controlgrpc

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"net/url"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestManagementMutualTLSAndBoundControllerIdentity(t *testing.T) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "test management CA"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	der, err := x509.CreateCertificate(rand.Reader, ca, ca, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	root, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(root)
	certificate := func(serial int64, identity string, server bool) tls.Certificate {
		p, k, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			t.Fatal(e)
		}
		uri, e := url.Parse(identity)
		if e != nil {
			t.Fatal(e)
		}
		leaf := &x509.Certificate{SerialNumber: big.NewInt(serial), NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), URIs: []*url.URL{uri}, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
		if server {
			leaf.DNSNames = []string{"cloud.test"}
			leaf.ExtKeyUsage = []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
		}
		data, e := x509.CreateCertificate(rand.Reader, leaf, root, p, key)
		if e != nil {
			t.Fatal(e)
		}
		return tls.Certificate{Certificate: [][]byte{data, der}, PrivateKey: k}
	}
	serverCertificate := certificate(2, "spiffe://ora/cloud/control", true)
	trusted := certificate(3, "spiffe://ora/controller/controller-a", false)
	wrongScope := certificate(4, "spiffe://ora/workload/user-code", false)
	server, err := NewSecure(nil, &tls.Config{MinVersion: tls.VersionTLS13, ClientAuth: tls.RequireAndVerifyClientCert, ClientCAs: roots, Certificates: []tls.Certificate{serverCertificate}}, "spiffe://ora/controller/controller-a")
	if err != nil {
		t.Fatal(err)
	}
	healthpb.RegisterHealthServer(server, health.NewServer())
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(server.Stop)
	for _, test := range []struct {
		name, holder string
		cert         *tls.Certificate
		want         codes.Code
	}{
		{"trusted", "controller-a", &trusted, codes.OK},
		{"identity spoof", "controller-b", &trusted, codes.PermissionDenied},
		{"workload certificate", "controller-a", &wrongScope, codes.PermissionDenied},
		{"missing certificate", "controller-a", nil, codes.Unavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			configuration := &tls.Config{MinVersion: tls.VersionTLS13, RootCAs: roots, ServerName: "cloud.test"}
			if test.cert != nil {
				configuration.Certificates = []tls.Certificate{*test.cert}
			}
			conn, e := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(credentials.NewTLS(configuration)))
			if e != nil {
				t.Fatal(e)
			}
			defer conn.Close()
			ctx, cancel := context.WithTimeout(metadata.AppendToOutgoingContext(context.Background(), HolderMetadata, test.holder), time.Second)
			defer cancel()
			_, e = healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
			if status.Code(e) != test.want {
				t.Fatalf("want %v got %v", test.want, e)
			}
		})
	}
}

func TestProductionControlRefusesMissingTLS(t *testing.T) {
	if _, err := NewSecure(nil, nil, "spiffe://ora/controller/controller-a"); err == nil {
		t.Fatal("plaintext management accepted")
	}
}
