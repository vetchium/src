package orgsapi

import "backend/internal/envconfig"

type Config struct {
	TenantID    string
	DatabaseURL string
}

func LoadConfig() (Config, error) {
	tenantID, databaseURL, err := envconfig.TenantDatabase()
	if err != nil {
		return Config{}, err
	}
	return Config{TenantID: tenantID, DatabaseURL: databaseURL}, nil
}
