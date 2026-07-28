package config

import (
	"fmt"
	"os"
)

type Config struct {
	Env         string
	TenantID    string
	DatabaseURL string
	PortalPort  string
	MeshPort    string
}

func Load() (*Config, error) {
	env := os.Getenv("ENV")
	if env != "dev" && env != "ci" && env != "staging" && env != "prod" {
		return nil, fmt.Errorf("invalid or missing ENV: %s", env)
	}

	tenantID := os.Getenv("TENANT_ID")
	if tenantID != "sgp" && tenantID != "usa1" && tenantID != "deu" && tenantID != "ind1" {
		return nil, fmt.Errorf("invalid or missing TENANT_ID: %s", tenantID)
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("missing DATABASE_URL")
	}

	portalPort := os.Getenv("PORTAL_PORT")
	if portalPort == "" {
		portalPort = "8080"
	}

	meshPort := os.Getenv("MESH_PORT")
	if meshPort == "" {
		meshPort = "8081"
	}

	return &Config{
		Env:         env,
		TenantID:    tenantID,
		DatabaseURL: dbURL,
		PortalPort:  portalPort,
		MeshPort:    meshPort,
	}, nil
}
