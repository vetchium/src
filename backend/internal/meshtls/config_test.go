package meshtls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestMutualTLSConfigurations(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	caCertificate, caKey, caFile := writeCA(t, directory)
	serverCertificate, serverKey := writeLeaf(
		t, directory, "server", caCertificate, caKey,
		x509.ExtKeyUsageServerAuth,
	)
	clientCertificate, clientKey := writeLeaf(
		t, directory, "client", caCertificate, caKey,
		x509.ExtKeyUsageClientAuth,
	)

	server, err := ServerConfig(serverCertificate, serverKey, caFile)
	if err != nil {
		t.Fatal(err)
	}
	if server.MinVersion != minimumVersion ||
		server.ClientAuth != tls.RequireAndVerifyClientCert ||
		server.ClientCAs == nil {
		t.Fatalf("server TLS config = %+v", server)
	}

	client, err := ClientConfig(
		clientCertificate, clientKey, caFile, "global-coordinator.test",
	)
	if err != nil {
		t.Fatal(err)
	}
	if client.MinVersion != minimumVersion || client.RootCAs == nil ||
		client.ServerName != "global-coordinator.test" ||
		len(client.Certificates) != 1 {
		t.Fatalf("client TLS config = %+v", client)
	}

}

func TestClientConfigRequiresServerName(t *testing.T) {
	t.Parallel()
	directory := t.TempDir()
	caCertificate, caKey, caFile := writeCA(t, directory)
	certificate, key := writeLeaf(
		t, directory, "client", caCertificate, caKey,
		x509.ExtKeyUsageClientAuth,
	)
	if _, err := ClientConfig(certificate, key, caFile, ""); err == nil {
		t.Fatal("ClientConfig() accepted an empty server name")
	}
}

func writeCA(
	t *testing.T, directory string,
) (*x509.Certificate, *ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "mesh test CA"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(
		rand.Reader, template, template, &key.PublicKey, key,
	)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "ca.pem")
	writePEM(t, path, "CERTIFICATE", der)
	return certificate, key, path
}

func writeLeaf(
	t *testing.T, directory, name string, ca *x509.Certificate,
	caKey *ecdsa.PrivateKey, usage x509.ExtKeyUsage,
) (string, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(int64(len(name) + int(usage))),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{"global-coordinator.test"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
	}
	der, err := x509.CreateCertificate(
		rand.Reader, template, ca, &key.PublicKey, caKey,
	)
	if err != nil {
		t.Fatal(err)
	}
	certificatePath := filepath.Join(directory, name+".pem")
	writePEM(t, certificatePath, "CERTIFICATE", der)
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyPath := filepath.Join(directory, name+".key")
	writePEM(t, keyPath, "PRIVATE KEY", keyDER)
	return certificatePath, keyPath
}

func writePEM(t *testing.T, path, kind string, contents []byte) {
	t.Helper()
	encoded := pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: contents})
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}
