package bgjobs

import (
	"os"
	"time"

	"vetchium-api-server.gomodule/internal/server"
)

// GlobalBgJobsConfig holds configuration for global database background jobs
type GlobalBgJobsConfig struct {
	ExpiredAdminTFATokensCleanupInterval  time.Duration
	ExpiredAdminSessionsCleanupInterval   time.Duration
	ExpiredHubSignupTokensCleanupInterval time.Duration
}

// RegionalBgJobsConfig holds configuration for regional database background jobs
type RegionalBgJobsConfig struct {
	ExpiredHubTFATokensCleanupInterval time.Duration
	ExpiredHubSessionsCleanupInterval  time.Duration
}

// GlobalConfigFromEnv creates a GlobalBgJobsConfig from environment variables
func GlobalConfigFromEnv() *GlobalBgJobsConfig {
	adminTFAInterval := parseDurationOrDefault(
		os.Getenv("EXPIRED_ADMIN_TFA_TOKENS_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	adminSessionsInterval := parseDurationOrDefault(
		os.Getenv("EXPIRED_ADMIN_SESSIONS_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubSignupInterval := parseDurationOrDefault(
		os.Getenv("EXPIRED_HUB_SIGNUP_TOKENS_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	return &GlobalBgJobsConfig{
		ExpiredAdminTFATokensCleanupInterval:  adminTFAInterval,
		ExpiredAdminSessionsCleanupInterval:   adminSessionsInterval,
		ExpiredHubSignupTokensCleanupInterval: hubSignupInterval,
	}
}

// RegionalConfigFromEnv creates a RegionalBgJobsConfig from environment variables
func RegionalConfigFromEnv() *RegionalBgJobsConfig {
	hubTFAInterval := parseDurationOrDefault(
		os.Getenv("EXPIRED_HUB_TFA_TOKENS_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubSessionsInterval := parseDurationOrDefault(
		os.Getenv("EXPIRED_HUB_SESSIONS_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	return &RegionalBgJobsConfig{
		ExpiredHubTFATokensCleanupInterval: hubTFAInterval,
		ExpiredHubSessionsCleanupInterval:  hubSessionsInterval,
	}
}

// TokenConfigFromEnv creates a TokenConfig from environment variables
func TokenConfigFromEnv() *server.TokenConfig {
	hubSignupExpiry := parseDurationOrDefault(
		os.Getenv("HUB_SIGNUP_TOKEN_EXPIRY"),
		24*time.Hour,
	)

	return &server.TokenConfig{
		HubSignupTokenExpiry: hubSignupExpiry,
	}
}

// parseDurationOrDefault parses a duration string or returns the default value
func parseDurationOrDefault(s string, defaultVal time.Duration) time.Duration {
	if s == "" {
		return defaultVal
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return defaultVal
	}
	return d
}
