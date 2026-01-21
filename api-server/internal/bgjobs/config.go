package bgjobs

import (
	"os"
	"time"

	"vetchium-api-server.gomodule/internal/server"
)

// GlobalBgJobsConfig holds configuration for global database background jobs
type GlobalBgJobsConfig struct {
	ExpiredAdminTFATokensCleanupInterval     time.Duration
	ExpiredAdminSessionsCleanupInterval      time.Duration
	ExpiredHubSignupTokensCleanupInterval    time.Duration
	ExpiredOrgSignupTokensCleanupInterval    time.Duration
	ExpiredAgencySignupTokensCleanupInterval time.Duration
}

// RegionalBgJobsConfig holds configuration for regional database background jobs
type RegionalBgJobsConfig struct {
	ExpiredHubTFATokensCleanupInterval               time.Duration
	ExpiredHubSessionsCleanupInterval                time.Duration
	ExpiredHubPasswordResetTokensCleanupInterval     time.Duration
	ExpiredHubEmailVerificationTokensCleanupInterval time.Duration
	ExpiredOrgTFATokensCleanupInterval               time.Duration
	ExpiredOrgSessionsCleanupInterval                time.Duration
	ExpiredAgencyTFATokensCleanupInterval            time.Duration
	ExpiredAgencySessionsCleanupInterval             time.Duration
}

// GlobalConfigFromEnv creates a GlobalBgJobsConfig from environment variables
func GlobalConfigFromEnv() *GlobalBgJobsConfig {
	adminTFAInterval := parseDurationOrDefault(
		os.Getenv("ADMIN_TFA_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	adminSessionsInterval := parseDurationOrDefault(
		os.Getenv("ADMIN_SESSION_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubSignupInterval := parseDurationOrDefault(
		os.Getenv("HUB_SIGNUP_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	orgSignupInterval := parseDurationOrDefault(
		os.Getenv("ORG_SIGNUP_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	agencySignupInterval := parseDurationOrDefault(
		os.Getenv("AGENCY_SIGNUP_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	return &GlobalBgJobsConfig{
		ExpiredAdminTFATokensCleanupInterval:     adminTFAInterval,
		ExpiredAdminSessionsCleanupInterval:      adminSessionsInterval,
		ExpiredHubSignupTokensCleanupInterval:    hubSignupInterval,
		ExpiredOrgSignupTokensCleanupInterval:    orgSignupInterval,
		ExpiredAgencySignupTokensCleanupInterval: agencySignupInterval,
	}
}

// RegionalConfigFromEnv creates a RegionalBgJobsConfig from environment variables
func RegionalConfigFromEnv() *RegionalBgJobsConfig {
	hubTFAInterval := parseDurationOrDefault(
		os.Getenv("HUB_TFA_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubSessionsInterval := parseDurationOrDefault(
		os.Getenv("HUB_SESSION_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubPasswordResetInterval := parseDurationOrDefault(
		os.Getenv("HUB_PASSWORD_RESET_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	hubEmailVerificationInterval := parseDurationOrDefault(
		os.Getenv("HUB_EMAIL_VERIFICATION_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	orgTFAInterval := parseDurationOrDefault(
		os.Getenv("ORG_TFA_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	orgSessionsInterval := parseDurationOrDefault(
		os.Getenv("ORG_SESSION_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	agencyTFAInterval := parseDurationOrDefault(
		os.Getenv("AGENCY_TFA_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	agencySessionsInterval := parseDurationOrDefault(
		os.Getenv("AGENCY_SESSION_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	return &RegionalBgJobsConfig{
		ExpiredHubTFATokensCleanupInterval:               hubTFAInterval,
		ExpiredHubSessionsCleanupInterval:                hubSessionsInterval,
		ExpiredHubPasswordResetTokensCleanupInterval:     hubPasswordResetInterval,
		ExpiredHubEmailVerificationTokensCleanupInterval: hubEmailVerificationInterval,
		ExpiredOrgTFATokensCleanupInterval:               orgTFAInterval,
		ExpiredOrgSessionsCleanupInterval:                orgSessionsInterval,
		ExpiredAgencyTFATokensCleanupInterval:            agencyTFAInterval,
		ExpiredAgencySessionsCleanupInterval:             agencySessionsInterval,
	}
}

// TokenConfigFromEnv creates a TokenConfig from environment variables
func TokenConfigFromEnv() *server.TokenConfig {
	// Hub token expiry durations
	hubSignupExpiry := parseDurationOrDefault(
		os.Getenv("HUB_SIGNUP_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	hubTFAExpiry := parseDurationOrDefault(
		os.Getenv("HUB_TFA_TOKEN_EXPIRY"),
		10*time.Minute,
	)
	hubSessionExpiry := parseDurationOrDefault(
		os.Getenv("HUB_SESSION_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	hubRememberMeExpiry := parseDurationOrDefault(
		os.Getenv("HUB_REMEMBER_ME_EXPIRY"),
		365*24*time.Hour,
	)

	// Admin token expiry durations
	adminTFAExpiry := parseDurationOrDefault(
		os.Getenv("ADMIN_TFA_TOKEN_EXPIRY"),
		10*time.Minute,
	)
	adminSessionExpiry := parseDurationOrDefault(
		os.Getenv("ADMIN_SESSION_TOKEN_EXPIRY"),
		24*time.Hour,
	)

	// Org token expiry durations
	orgSignupExpiry := parseDurationOrDefault(
		os.Getenv("ORG_SIGNUP_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	orgTFAExpiry := parseDurationOrDefault(
		os.Getenv("ORG_TFA_TOKEN_EXPIRY"),
		10*time.Minute,
	)
	orgSessionExpiry := parseDurationOrDefault(
		os.Getenv("ORG_SESSION_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	orgRememberMeExpiry := parseDurationOrDefault(
		os.Getenv("ORG_REMEMBER_ME_EXPIRY"),
		365*24*time.Hour,
	)

	// Agency token expiry durations
	agencySignupExpiry := parseDurationOrDefault(
		os.Getenv("AGENCY_SIGNUP_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	agencyTFAExpiry := parseDurationOrDefault(
		os.Getenv("AGENCY_TFA_TOKEN_EXPIRY"),
		10*time.Minute,
	)
	agencySessionExpiry := parseDurationOrDefault(
		os.Getenv("AGENCY_SESSION_TOKEN_EXPIRY"),
		24*time.Hour,
	)
	agencyRememberMeExpiry := parseDurationOrDefault(
		os.Getenv("AGENCY_REMEMBER_ME_EXPIRY"),
		365*24*time.Hour,
	)

	// Password reset token expiry (all portals)
	passwordResetExpiry := parseDurationOrDefault(
		os.Getenv("PASSWORD_RESET_TOKEN_EXPIRY"),
		1*time.Hour,
	)

	// Email verification token expiry
	emailVerificationExpiry := parseDurationOrDefault(
		os.Getenv("EMAIL_VERIFICATION_TOKEN_EXPIRY"),
		1*time.Hour,
	)

	return &server.TokenConfig{
		HubSignupTokenExpiry:         hubSignupExpiry,
		HubTFATokenExpiry:            hubTFAExpiry,
		HubSessionTokenExpiry:        hubSessionExpiry,
		HubRememberMeExpiry:          hubRememberMeExpiry,
		AdminTFATokenExpiry:          adminTFAExpiry,
		AdminSessionTokenExpiry:      adminSessionExpiry,
		OrgSignupTokenExpiry:         orgSignupExpiry,
		OrgTFATokenExpiry:            orgTFAExpiry,
		OrgSessionTokenExpiry:        orgSessionExpiry,
		OrgRememberMeExpiry:          orgRememberMeExpiry,
		AgencySignupTokenExpiry:      agencySignupExpiry,
		AgencyTFATokenExpiry:         agencyTFAExpiry,
		AgencySessionTokenExpiry:     agencySessionExpiry,
		AgencyRememberMeExpiry:       agencyRememberMeExpiry,
		PasswordResetTokenExpiry:     passwordResetExpiry,
		EmailVerificationTokenExpiry: emailVerificationExpiry,
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
