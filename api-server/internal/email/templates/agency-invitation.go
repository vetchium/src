package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsAgencyInvitation = "emails/agency_invitation"

// AgencyInvitationData contains data for the agency user invitation email
type AgencyInvitationData struct {
	InvitationToken string // Invitation token
	InviterName     string // Name of the person who sent the invitation
	AgencyName      string // Name of the agency
	Days            int    // Expiry time in days
}

// AgencyInvitationSubject returns the localized email subject for agency invitation
func AgencyInvitationSubject(lang string, data AgencyInvitationData) string {
	return i18n.TF(lang, nsAgencyInvitation, "subject", data)
}

// AgencyInvitationTextBody returns the localized plain text body for agency invitation email
func AgencyInvitationTextBody(lang string, data AgencyInvitationData) string {
	portalName := i18n.T(lang, nsAgencyInvitation, "portal_name")
	greeting := i18n.T(lang, nsAgencyInvitation, "body_greeting")
	intro := i18n.TF(lang, nsAgencyInvitation, "body_intro", data)
	setupLink := fmt.Sprintf("https://agency.vetchium.com/complete-setup?token=%s", data.InvitationToken)
	expiry := i18n.TF(lang, nsAgencyInvitation, "body_expiry", data)
	instructions := i18n.T(lang, nsAgencyInvitation, "body_instructions")
	security := i18n.T(lang, nsAgencyInvitation, "body_security")
	footer := i18n.T(lang, nsAgencyInvitation, "footer")

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

// AgencyInvitationHTMLBody returns the localized HTML body for agency invitation email
func AgencyInvitationHTMLBody(lang string, data AgencyInvitationData) string {
	portalName := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "portal_name"))
	greeting := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "body_greeting"))
	intro := html.EscapeString(i18n.TF(lang, nsAgencyInvitation, "body_intro", data))
	setupLink := html.EscapeString(fmt.Sprintf("https://agency.vetchium.com/complete-setup?token=%s", data.InvitationToken))
	buttonText := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "button_text"))
	expiry := html.EscapeString(i18n.TF(lang, nsAgencyInvitation, "body_expiry", data))
	instructions := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "body_instructions"))
	security := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "body_security"))
	footer := html.EscapeString(i18n.T(lang, nsAgencyInvitation, "footer"))

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
