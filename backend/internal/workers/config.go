package workers

import (
	"time"

	"backend/internal/envconfig"
)

type Config struct {
	TenantID                           string
	DatabaseURL                        string
	DeleteExpiredAdminSessionsInterval time.Duration
}

func LoadConfig() (Config, error) {
	tenantID, databaseURL, err := envconfig.TenantDatabase()
	if err != nil {
		return Config{}, err
	}
	interval, err := envconfig.PositiveDuration("DELETE_EXPIRED_ADMIN_SESSIONS_INTERVAL")
	if err != nil {
		return Config{}, err
	}
	return Config{
		TenantID:                           tenantID,
		DatabaseURL:                        databaseURL,
		DeleteExpiredAdminSessionsInterval: interval,
	}, nil
}
