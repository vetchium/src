package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsHubWorkEmailVerification = "emails/hub_work_email_verification"

// HubWorkEmailVerificationData contains data for the work email verification code email
type HubWorkEmailVerificationData struct {
	Code               string // 6-digit verification code
	Domain             string // employer domain
	HubUserDisplayName string // user's display name
	ExpiresAt          string // human-readable expiry
}

// HubWorkEmailVerificationSubject returns the localized email subject
func HubWorkEmailVerificationSubject(lang string) string {
	return i18n.T(lang, nsHubWorkEmailVerification, "subject")
}

// HubWorkEmailVerificationTextBody returns the plain text body
func HubWorkEmailVerificationTextBody(lang string, data HubWorkEmailVerificationData) string {
	intro := i18n.TF(lang, nsHubWorkEmailVerification, "body_intro", data)
	codeLabel := i18n.T(lang, nsHubWorkEmailVerification, "body_code_label")
	expiry := i18n.TF(lang, nsHubWorkEmailVerification, "body_expiry", data)
	ignore := i18n.T(lang, nsHubWorkEmailVerification, "body_ignore")
	footer := i18n.T(lang, nsHubWorkEmailVerification, "footer")

	return fmt.Sprintf(`Vetchium - Work Email Verification

%s

%s %s

%s

%s

---
Vetchium
%s
`, intro, codeLabel, data.Code, expiry, ignore, footer)
}

// HubWorkEmailVerificationHTMLBody returns the HTML body
func HubWorkEmailVerificationHTMLBody(lang string, data HubWorkEmailVerificationData) string {
	escapedCode := html.EscapeString(data.Code)
	escapedDomain := html.EscapeString(data.Domain)
	intro := html.EscapeString(i18n.TF(lang, nsHubWorkEmailVerification, "body_intro", data))
	codeLabel := html.EscapeString(i18n.T(lang, nsHubWorkEmailVerification, "body_code_label"))
	expiry := html.EscapeString(i18n.TF(lang, nsHubWorkEmailVerification, "body_expiry", data))
	ignore := html.EscapeString(i18n.T(lang, nsHubWorkEmailVerification, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsHubWorkEmailVerification, "footer"))

	htmlLang := "en"
	if len(lang) >= 2 {
		htmlLang = lang[:2]
	}

	_ = escapedDomain

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Work Email Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eee;">
                            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">Vetchium</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #333333;">%s</p>
                            <p style="margin: 0 0 8px; font-size: 14px; color: #666666;">%s</p>
                            <div style="text-align: center; margin: 16px 0;">
                                <span style="display: inline-block; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; background-color: #f0f0f0; padding: 16px 32px; border-radius: 8px; font-family: 'Courier New', monospace;">%s</span>
                            </div>
                            <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: #666666;">%s</p>
                            <p style="margin: 16px 0 0; font-size: 14px; line-height: 20px; color: #666666;">%s</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #eee; background-color: #fafafa; border-radius: 0 0 8px 8px;">
                            <p style="margin: 0; font-size: 12px; color: #999999;">%s</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`, htmlLang, intro, codeLabel, escapedCode, expiry, ignore, footer)
}
