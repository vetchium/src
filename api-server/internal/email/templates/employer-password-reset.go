package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsEmployerPasswordReset = "emails/employer_password_reset"

// EmployerPasswordResetData contains data for the org password reset email
type EmployerPasswordResetData struct {
	ResetToken string // Password reset token
	Domain     string // Domain name for the reset link
	Hours      int    // Expiry time in hours
	BaseURL    string // Base URL of the Org UI
}

// EmployerPasswordResetSubject returns the localized email subject for org password reset
func EmployerPasswordResetSubject(lang string) string {
	return i18n.T(lang, nsEmployerPasswordReset, "subject")
}

// EmployerPasswordResetTextBody returns the localized plain text body for org password reset email
func EmployerPasswordResetTextBody(lang string, data EmployerPasswordResetData) string {
	portalName := i18n.T(lang, nsEmployerPasswordReset, "portal_name")
	greeting := i18n.T(lang, nsEmployerPasswordReset, "body_greeting")
	intro := i18n.T(lang, nsEmployerPasswordReset, "body_intro")
	resetLink := fmt.Sprintf("%s/reset-password?token=%s", data.BaseURL, data.ResetToken)
	expiry := i18n.TF(lang, nsEmployerPasswordReset, "body_expiry", data)
	security := i18n.T(lang, nsEmployerPasswordReset, "body_security")
	ignore := i18n.T(lang, nsEmployerPasswordReset, "body_ignore")
	footer := i18n.T(lang, nsEmployerPasswordReset, "footer")

	return fmt.Sprintf(`%s - Password Reset

%s

%s

%s

%s

%s

%s

---
%s
%s
`, portalName, greeting, intro, resetLink, expiry, security, ignore, portalName, footer)
}

// EmployerPasswordResetHTMLBody returns the localized HTML body for org password reset email
func EmployerPasswordResetHTMLBody(lang string, data EmployerPasswordResetData) string {
	portalName := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "portal_name"))
	greeting := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "body_greeting"))
	intro := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "body_intro"))
	resetLink := html.EscapeString(fmt.Sprintf("%s/reset-password?token=%s", data.BaseURL, data.ResetToken))
	buttonText := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "button_text"))
	expiry := html.EscapeString(i18n.TF(lang, nsEmployerPasswordReset, "body_expiry", data))
	security := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "body_security"))
	ignore := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsEmployerPasswordReset, "footer"))

	// Determine lang attribute for HTML
	htmlLang := "en"
	if len(lang) >= 2 {
		htmlLang = lang[:2]
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eee;">
                            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">%s</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                %s
                            </p>
                            <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #333333;">
                                %s
                            </p>
                            <div style="text-align: center; margin: 24px 0;">
                                <a href="%s" style="display: inline-block; padding: 12px 32px; background-color: #1a73e8; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 500; font-size: 16px;">%s</a>
                            </div>
                            <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>
                            <p style="margin: 16px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>
                            <p style="margin: 16px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #eee; background-color: #fafafa; border-radius: 0 0 8px 8px;">
                            <p style="margin: 0; font-size: 12px; color: #999999;">
                                %s
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`, htmlLang, portalName, greeting, intro, resetLink, buttonText, expiry, security, ignore, footer)
}
