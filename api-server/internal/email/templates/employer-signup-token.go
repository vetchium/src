package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsEmployerSignupToken = "emails/employer_signup_token"

// EmployerSignupTokenData contains data for the org signup token email (private, not to be forwarded)
type EmployerSignupTokenData struct {
	Domain      string // The domain being verified
	SignupToken string // Secret token to complete signup
	SignupLink  string // Full URL to complete signup (includes token)
	Hours       int    // Expiry time in hours
}

// EmployerSignupTokenSubject returns the localized email subject for org signup token email
func EmployerSignupTokenSubject(lang string) string {
	return i18n.T(lang, nsEmployerSignupToken, "subject")
}

// EmployerSignupTokenTextBody returns the localized plain text body for org signup token email
func EmployerSignupTokenTextBody(lang string, data EmployerSignupTokenData) string {
	portalName := i18n.T(lang, nsEmployerSignupToken, "portal_name")
	warning := i18n.T(lang, nsEmployerSignupToken, "warning_do_not_forward")
	intro := i18n.TF(lang, nsEmployerSignupToken, "body_intro", data)
	dnsNote := i18n.T(lang, nsEmployerSignupToken, "body_dns_note")
	clickHere := i18n.T(lang, nsEmployerSignupToken, "body_click_here")
	orUseToken := i18n.T(lang, nsEmployerSignupToken, "body_or_use_token")
	expiry := i18n.TF(lang, nsEmployerSignupToken, "body_expiry", data)
	ignore := i18n.T(lang, nsEmployerSignupToken, "body_ignore")
	footer := i18n.T(lang, nsEmployerSignupToken, "footer")

	return fmt.Sprintf(`%s - Complete Your Signup

*************************************
%s
*************************************

%s

%s

%s
%s

%s
%s

%s

%s

---
%s
%s
`, portalName, warning, intro, dnsNote, clickHere, data.SignupLink, orUseToken, data.SignupToken, expiry, ignore, portalName, footer)
}

// EmployerSignupTokenHTMLBody returns the localized HTML body for org signup token email
func EmployerSignupTokenHTMLBody(lang string, data EmployerSignupTokenData) string {
	escapedLink := html.EscapeString(data.SignupLink)
	escapedToken := html.EscapeString(data.SignupToken)
	escapedDomain := html.EscapeString(data.Domain)
	portalName := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "portal_name"))
	warning := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "warning_do_not_forward"))
	intro := html.EscapeString(i18n.TF(lang, nsEmployerSignupToken, "body_intro", data))
	dnsNote := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "body_dns_note"))
	buttonText := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "button_text"))
	orUseToken := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "body_or_use_token"))
	expiry := html.EscapeString(i18n.TF(lang, nsEmployerSignupToken, "body_expiry", data))
	ignore := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsEmployerSignupToken, "footer"))

	// Suppress unused variable warning
	_ = escapedDomain

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
    <title>Complete Your Employer Signup</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eee;">
                            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">%s</h1>
                        </td>
                    </tr>
                    <!-- Warning Banner -->
                    <tr>
                        <td style="padding: 0;">
                            <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px 32px; margin: 0;">
                                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #dc2626;">
                                    ⚠️ %s
                                </p>
                            </div>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                %s
                            </p>
                            <p style="margin: 0 0 24px; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>
                            <div style="text-align: center; margin: 32px 0;">
                                <a href="%s" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">%s</a>
                            </div>
                            <p style="margin: 24px 0 16px; font-size: 14px; line-height: 20px; color: #666666; text-align: center;">
                                %s
                            </p>
                            <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 16px; text-align: center;">
                                <code style="font-size: 14px; font-family: monospace; color: #212529; word-break: break-all;">%s</code>
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
</html>`, htmlLang, portalName, warning, intro, dnsNote, escapedLink, buttonText, orUseToken, escapedToken, expiry, ignore, footer)
}
