package bgjobs

import (
	"os"
	"time"

	"vetchium-api-server.gomodule/internal/server"
)

// GlobalBgJobsConfig holds configuration for global database background jobs
type GlobalBgJobsConfig struct {
	ExpiredAdminTFATokensCleanupInterval           time.Duration
	ExpiredAdminSessionsCleanupInterval            time.Duration
	ExpiredAdminPasswordResetTokensCleanupInterval time.Duration
	ExpiredAdminInvitationTokensCleanupInterval    time.Duration
	ExpiredHubSignupTokensCleanupInterval          time.Duration
	ExpiredOrgSignupTokensCleanupInterval          time.Duration
	AdminAuditLogRetention                         time.Duration
	AdminAuditLogPurgeInterval                     time.Duration
	DomainCooldownCleanupInterval                  time.Duration
}

// RegionalBgJobsConfig holds configuration for regional database background jobs
type RegionalBgJobsConfig struct {
	ExpiredHubTFATokensCleanupInterval               time.Duration
	ExpiredHubSessionsCleanupInterval                time.Duration
	ExpiredHubPasswordResetTokensCleanupInterval     time.Duration
	ExpiredHubEmailVerificationTokensCleanupInterval time.Duration
	ExpiredOrgTFATokensCleanupInterval               time.Duration
	ExpiredOrgSessionsCleanupInterval                time.Duration
	ExpiredOrgPasswordResetTokensCleanupInterval     time.Duration
	ExpiredOrgInvitationTokensCleanupInterval        time.Duration
	OrgDomainVerificationInterval                    time.Duration
	AuditLogRetention                                time.Duration
	AuditLogPurgeInterval                            time.Duration
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

	adminPasswordResetInterval := parseDurationOrDefault(
		os.Getenv("ADMIN_PASSWORD_RESET_TOKEN_CLEANUP_INTERVAL"),
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

	adminInvitationInterval := parseDurationOrDefault(
		os.Getenv("ADMIN_INVITATION_TOKEN_CLEANUP_INTERVAL"),
		6*time.Hour,
	)

	adminAuditLogRetention := parseDurationOrDefault(
		os.Getenv("ADMIN_AUDIT_LOG_RETENTION"),
		17520*time.Hour, // 2 years
	)

	adminAuditLogPurgeInterval := parseDurationOrDefault(
		os.Getenv("ADMIN_AUDIT_LOG_PURGE_INTERVAL"),
		24*time.Hour,
	)

	domainCooldownCleanupInterval := parseDurationOrDefault(
		os.Getenv("DOMAIN_COOLDOWN_CLEANUP_INTERVAL"),
		24*time.Hour,
	)

	return &GlobalBgJobsConfig{
		ExpiredAdminTFATokensCleanupInterval:           adminTFAInterval,
		ExpiredAdminSessionsCleanupInterval:            adminSessionsInterval,
		ExpiredAdminPasswordResetTokensCleanupInterval: adminPasswordResetInterval,
		ExpiredAdminInvitationTokensCleanupInterval:    adminInvitationInterval,
		ExpiredHubSignupTokensCleanupInterval:          hubSignupInterval,
		ExpiredOrgSignupTokensCleanupInterval:          orgSignupInterval,
		AdminAuditLogRetention:                         adminAuditLogRetention,
		AdminAuditLogPurgeInterval:                     adminAuditLogPurgeInterval,
		DomainCooldownCleanupInterval:                  domainCooldownCleanupInterval,
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

	orgPasswordResetInterval := parseDurationOrDefault(
		os.Getenv("ORG_PASSWORD_RESET_TOKEN_CLEANUP_INTERVAL"),
		1*time.Hour,
	)

	orgInvitationInterval := parseDurationOrDefault(
		os.Getenv("ORG_INVITATION_TOKEN_CLEANUP_INTERVAL"),
		6*time.Hour,
	)

	orgDomainVerificationInterval := parseDurationOrDefault(
		os.Getenv("ORG_DOMAIN_VERIFICATION_INTERVAL"),
		24*time.Hour,
	)

	auditLogRetention := parseDurationOrDefault(
		os.Getenv("AUDIT_LOG_RETENTION"),
		17520*time.Hour, // 2 years
	)

	auditLogPurgeInterval := parseDurationOrDefault(
		os.Getenv("AUDIT_LOG_PURGE_INTERVAL"),
		24*time.Hour,
	)

	return &RegionalBgJobsConfig{
		ExpiredHubTFATokensCleanupInterval:               hubTFAInterval,
		ExpiredHubSessionsCleanupInterval:                hubSessionsInterval,
		ExpiredHubPasswordResetTokensCleanupInterval:     hubPasswordResetInterval,
		ExpiredHubEmailVerificationTokensCleanupInterval: hubEmailVerificationInterval,
		ExpiredOrgTFATokensCleanupInterval:               orgTFAInterval,
		ExpiredOrgSessionsCleanupInterval:                orgSessionsInterval,
		ExpiredOrgPasswordResetTokensCleanupInterval:     orgPasswordResetInterval,
		ExpiredOrgInvitationTokensCleanupInterval:        orgInvitationInterval,
		OrgDomainVerificationInterval:                    orgDomainVerificationInterval,
		AuditLogRetention:                                auditLogRetention,
		AuditLogPurgeInterval:                            auditLogPurgeInterval,
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

	// Invitation token expiry (all entity portals)
	orgInvitationExpiry := parseDurationOrDefault(
		os.Getenv("ORG_INVITATION_TOKEN_EXPIRY"),
		168*time.Hour, // 7 days
	)
	adminInvitationExpiry := parseDurationOrDefault(
		os.Getenv("ADMIN_INVITATION_TOKEN_EXPIRY"),
		168*time.Hour, // 7 days
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
		PasswordResetTokenExpiry:     passwordResetExpiry,
		EmailVerificationTokenExpiry: emailVerificationExpiry,
		OrgInvitationTokenExpiry:     orgInvitationExpiry,
		AdminInvitationTokenExpiry:   adminInvitationExpiry,
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
