package adminapi

import (
	"time"

	"backend/internal/envconfig"
)

type Config struct {
	TenantID        string
	DatabaseURL     string
	AdminSessionTTL time.Duration
}

func LoadConfig() (Config, error) {
	tenantID, databaseURL, err := envconfig.TenantDatabase()
	if err != nil {
		return Config{}, err
	}
	adminSessionTTL, err := envconfig.PositiveDuration("ADMIN_SESSION_TTL")
	if err != nil {
		return Config{}, err
	}
	return Config{
		TenantID:        tenantID,
		DatabaseURL:     databaseURL,
		AdminSessionTTL: adminSessionTTL,
	}, nil
}
