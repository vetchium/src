// Package meshtls loads private-CA TLS configurations for mesh services.
package meshtls

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"
)

const minimumVersion = tls.VersionTLS13

func ServerConfig(
	certificateFile, keyFile, clientCAFile string,
) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(certificateFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load mesh server key pair: %w", err)
	}
	clientCAs, err := certificatePool(clientCAFile)
	if err != nil {
		return nil, fmt.Errorf("load mesh client CA: %w", err)
	}
	return &tls.Config{
		MinVersion:   minimumVersion,
		Certificates: []tls.Certificate{certificate},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    clientCAs,
	}, nil
}

func ClientConfig(
	certificateFile, keyFile, rootCAFile, serverName string,
) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(certificateFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load mesh client key pair: %w", err)
	}
	roots, err := certificatePool(rootCAFile)
	if err != nil {
		return nil, fmt.Errorf("load mesh server CA: %w", err)
	}
	if serverName == "" {
		return nil, fmt.Errorf("mesh TLS server name must not be empty")
	}
	return &tls.Config{
		MinVersion:   minimumVersion,
		Certificates: []tls.Certificate{certificate},
		RootCAs:      roots,
		ServerName:   serverName,
	}, nil
}

func certificatePool(path string) (*x509.CertPool, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(contents) {
		return nil, fmt.Errorf("certificate file %q contains no certificates", path)
	}
	return pool, nil
}
