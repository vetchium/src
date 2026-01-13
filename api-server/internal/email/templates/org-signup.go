package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsOrgSignup = "emails/org_signup"

// OrgSignupData contains data for the org signup DNS verification email
type OrgSignupData struct {
	Domain         string // The domain being verified
	DNSRecordName  string // DNS TXT record name (e.g., _vetchium-verify.example.com)
	DNSRecordValue string // DNS TXT record value (verification token)
	Hours          int    // Expiry time in hours
}

// OrgSignupSubject returns the localized email subject for org signup
func OrgSignupSubject(lang string) string {
	return i18n.T(lang, nsOrgSignup, "subject")
}

// OrgSignupTextBody returns the localized plain text body for org signup email
func OrgSignupTextBody(lang string, data OrgSignupData) string {
	portalName := i18n.T(lang, nsOrgSignup, "portal_name")
	intro := i18n.T(lang, nsOrgSignup, "body_intro")
	dnsInstructions := i18n.TF(lang, nsOrgSignup, "body_dns_instructions", data)
	expiry := i18n.TF(lang, nsOrgSignup, "body_expiry", data)
	ignore := i18n.T(lang, nsOrgSignup, "body_ignore")
	footer := i18n.T(lang, nsOrgSignup, "footer")

	return fmt.Sprintf(`%s - Domain Verification Instructions

%s

%s

DNS Record Name:
%s

DNS Record Value:
%s

%s

%s

---
%s
%s
`, portalName, intro, dnsInstructions, data.DNSRecordName, data.DNSRecordValue, expiry, ignore, portalName, footer)
}

// OrgSignupHTMLBody returns the localized HTML body for org signup email
func OrgSignupHTMLBody(lang string, data OrgSignupData) string {
	escapedDNSName := html.EscapeString(data.DNSRecordName)
	escapedDNSValue := html.EscapeString(data.DNSRecordValue)
	escapedDomain := html.EscapeString(data.Domain)
	portalName := html.EscapeString(i18n.T(lang, nsOrgSignup, "portal_name"))
	intro := html.EscapeString(i18n.T(lang, nsOrgSignup, "body_intro"))
	dnsInstructions := html.EscapeString(i18n.TF(lang, nsOrgSignup, "body_dns_instructions", data))
	expiry := html.EscapeString(i18n.TF(lang, nsOrgSignup, "body_expiry", data))
	ignore := html.EscapeString(i18n.T(lang, nsOrgSignup, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsOrgSignup, "footer"))

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
    <title>Domain Verification Instructions</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
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
                            <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>
                            <!-- DNS Record Box -->
                            <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 20px; margin: 24px 0;">
                                <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #6c757d; text-transform: uppercase;">Domain</p>
                                <p style="margin: 0 0 16px; font-size: 14px; font-family: monospace; color: #212529; word-break: break-all;">%s</p>

                                <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #6c757d; text-transform: uppercase;">DNS Record Name (TXT)</p>
                                <p style="margin: 0 0 16px; font-size: 14px; font-family: monospace; color: #212529; word-break: break-all; background-color: #fff; padding: 10px; border-radius: 4px;">%s</p>

                                <p style="margin: 0 0 8px; font-size: 12px; font-weight: 600; color: #6c757d; text-transform: uppercase;">DNS Record Value</p>
                                <p style="margin: 0; font-size: 14px; font-family: monospace; color: #212529; word-break: break-all; background-color: #fff; padding: 10px; border-radius: 4px;">%s</p>
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
</html>`, htmlLang, portalName, intro, dnsInstructions, escapedDomain, escapedDNSName, escapedDNSValue, expiry, ignore, footer)
}
