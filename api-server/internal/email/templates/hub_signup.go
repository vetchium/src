package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsHubSignup = "emails/hub_signup"

// HubSignupData contains data for the hub signup verification email
type HubSignupData struct {
	SignupLink string // Full URL to complete signup
	Hours      int    // Expiry time in hours
}

// HubSignupSubject returns the localized email subject for hub signup
func HubSignupSubject(lang string) string {
	return i18n.T(lang, nsHubSignup, "subject")
}

// HubSignupTextBody returns the localized plain text body for hub signup email
func HubSignupTextBody(lang string, data HubSignupData) string {
	portalName := i18n.T(lang, nsHubSignup, "portal_name")
	intro := i18n.T(lang, nsHubSignup, "body_intro")
	clickHere := i18n.T(lang, nsHubSignup, "body_click_here")
	expiry := i18n.TF(lang, nsHubSignup, "body_expiry", data)
	ignore := i18n.T(lang, nsHubSignup, "body_ignore")
	footer := i18n.T(lang, nsHubSignup, "footer")

	return fmt.Sprintf(`%s - Complete Your Signup

%s

%s: %s

%s

%s

---
%s
%s
`, portalName, intro, clickHere, data.SignupLink, expiry, ignore, portalName, footer)
}

// HubSignupHTMLBody returns the localized HTML body for hub signup email
func HubSignupHTMLBody(lang string, data HubSignupData) string {
	escapedLink := html.EscapeString(data.SignupLink)
	portalName := html.EscapeString(i18n.T(lang, nsHubSignup, "portal_name"))
	intro := html.EscapeString(i18n.T(lang, nsHubSignup, "body_intro"))
	buttonText := html.EscapeString(i18n.T(lang, nsHubSignup, "button_text"))
	expiry := html.EscapeString(i18n.TF(lang, nsHubSignup, "body_expiry", data))
	ignore := html.EscapeString(i18n.T(lang, nsHubSignup, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsHubSignup, "footer"))

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
    <title>Complete Your Signup</title>
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
                            <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #333333;">
                                %s
                            </p>
                            <div style="text-align: center; margin: 32px 0;">
                                <a href="%s" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">%s</a>
                            </div>
                            <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
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
</html>`, htmlLang, portalName, intro, escapedLink, buttonText, expiry, ignore, footer)
}
