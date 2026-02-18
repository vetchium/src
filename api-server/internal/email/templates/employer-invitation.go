package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsEmployerInvitation = "emails/employer_invitation"

// EmployerInvitationData contains data for the org user invitation email
type EmployerInvitationData struct {
	InvitationToken string // Invitation token
	InviterName     string // Name of the person who sent the invitation
	EmployerName    string // Name of the employer/organization
	Days            int    // Expiry time in days
	BaseURL         string // Base URL of the Org UI
}

// EmployerInvitationSubject returns the localized email subject for org invitation
func EmployerInvitationSubject(lang string, data EmployerInvitationData) string {
	return i18n.TF(lang, nsEmployerInvitation, "subject", data)
}

// EmployerInvitationTextBody returns the localized plain text body for org invitation email
func EmployerInvitationTextBody(lang string, data EmployerInvitationData) string {
	portalName := i18n.T(lang, nsEmployerInvitation, "portal_name")
	greeting := i18n.T(lang, nsEmployerInvitation, "body_greeting")
	intro := i18n.TF(lang, nsEmployerInvitation, "body_intro", data)
	setupLink := fmt.Sprintf("%s/complete-setup?token=%s", data.BaseURL, data.InvitationToken)
	expiry := i18n.TF(lang, nsEmployerInvitation, "body_expiry", data)
	instructions := i18n.T(lang, nsEmployerInvitation, "body_instructions")
	security := i18n.T(lang, nsEmployerInvitation, "body_security")
	footer := i18n.T(lang, nsEmployerInvitation, "footer")

	return fmt.Sprintf(`%s - Invitation

%s

%s

%s

%s

%s

%s

---
%s
%s
`, portalName, greeting, intro, setupLink, expiry, instructions, security, portalName, footer)
}

// EmployerInvitationHTMLBody returns the localized HTML body for org invitation email
func EmployerInvitationHTMLBody(lang string, data EmployerInvitationData) string {
	portalName := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "portal_name"))
	greeting := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "body_greeting"))
	intro := html.EscapeString(i18n.TF(lang, nsEmployerInvitation, "body_intro", data))
	setupLink := html.EscapeString(fmt.Sprintf("%s/complete-setup?token=%s", data.BaseURL, data.InvitationToken))
	buttonText := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "button_text"))
	expiry := html.EscapeString(i18n.TF(lang, nsEmployerInvitation, "body_expiry", data))
	instructions := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "body_instructions"))
	security := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "body_security"))
	footer := html.EscapeString(i18n.T(lang, nsEmployerInvitation, "footer"))

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
    <title>Invitation</title>
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
</html>`, htmlLang, portalName, greeting, intro, setupLink, buttonText, expiry, instructions, security, footer)
}
