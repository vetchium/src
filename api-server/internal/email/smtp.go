package email

import (
	"os"
	"strconv"
)

// SMTPConfig holds SMTP server configuration
type SMTPConfig struct {
	Host        string
	Port        int
	Username    string
	Password    string
	FromAddress string
	FromName    string
}

// SMTPConfigFromEnv creates a SMTPConfig from environment variables
func SMTPConfigFromEnv() *SMTPConfig {
	port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if port == 0 {
		port = 1025 // Default Mailpit port
	}

	return &SMTPConfig{
		Host:        getEnvOrDefault("SMTP_HOST", "localhost"),
		Port:        port,
		Username:    os.Getenv("SMTP_USERNAME"),
		Password:    os.Getenv("SMTP_PASSWORD"),
		FromAddress: getEnvOrDefault("SMTP_FROM_ADDRESS", "noreply@vetchium.com"),
		FromName:    getEnvOrDefault("SMTP_FROM_NAME", "Vetchium"),
	}
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
