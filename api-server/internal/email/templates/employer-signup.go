package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsEmployerSignup = "emails/employer_signup"

// EmployerSignupData contains data for the org signup DNS verification email
type EmployerSignupData struct {
	Domain         string // The domain being verified
	DNSRecordName  string // DNS TXT record name (e.g., _vetchium-verify.example.com)
	DNSRecordValue string // DNS TXT record value (verification token)
	Hours          int    // Expiry time in hours
}

// EmployerSignupSubject returns the localized email subject for org signup
func EmployerSignupSubject(lang string) string {
	return i18n.T(lang, nsEmployerSignup, "subject")
}

// EmployerSignupTextBody returns the localized plain text body for org signup email
func EmployerSignupTextBody(lang string, data EmployerSignupData) string {
	portalName := i18n.T(lang, nsEmployerSignup, "portal_name")
	intro := i18n.T(lang, nsEmployerSignup, "body_intro")
	separateEmailNote := i18n.T(lang, nsEmployerSignup, "body_separate_email_note")
	dnsInstructions := i18n.TF(lang, nsEmployerSignup, "body_dns_instructions", data)
	step1 := i18n.T(lang, nsEmployerSignup, "step1")
	step2 := i18n.T(lang, nsEmployerSignup, "step2")
	step3 := i18n.T(lang, nsEmployerSignup, "step3")
	step4 := i18n.T(lang, nsEmployerSignup, "step4")
	step5 := i18n.T(lang, nsEmployerSignup, "step5")
	recordTypeLabel := i18n.T(lang, nsEmployerSignup, "record_type_label")
	hostLabel := i18n.T(lang, nsEmployerSignup, "host_label")
	valueLabel := i18n.T(lang, nsEmployerSignup, "value_label")
	ttlLabel := i18n.T(lang, nsEmployerSignup, "ttl_label")
	propagationNote := i18n.T(lang, nsEmployerSignup, "propagation_note")
	expiry := i18n.TF(lang, nsEmployerSignup, "body_expiry", data)
	ignore := i18n.T(lang, nsEmployerSignup, "body_ignore")
	footer := i18n.T(lang, nsEmployerSignup, "footer")

	return fmt.Sprintf(`%s - Domain Verification Instructions

%s

%s

%s

STEP-BY-STEP INSTRUCTIONS:
==========================

1. %s
2. %s
3. %s
4. %s
5. %s

DNS RECORD DETAILS:
===================

%s TXT
%s _vetchium-verify (or _vetchium-verify.%s for full hostname)
%s %s
%s 300 (or default)

%s

%s

%s

---
%s
%s
`, portalName, intro, dnsInstructions, separateEmailNote,
		step1, step2, step3, step4, step5,
		recordTypeLabel, hostLabel, data.Domain, valueLabel, data.DNSRecordValue, ttlLabel,
		propagationNote, expiry, ignore, portalName, footer)
}

// EmployerSignupHTMLBody returns the localized HTML body for org signup email
func EmployerSignupHTMLBody(lang string, data EmployerSignupData) string {
	escapedDNSValue := html.EscapeString(data.DNSRecordValue)
	escapedDomain := html.EscapeString(data.Domain)
	portalName := html.EscapeString(i18n.T(lang, nsEmployerSignup, "portal_name"))
	intro := html.EscapeString(i18n.T(lang, nsEmployerSignup, "body_intro"))
	separateEmailNote := html.EscapeString(i18n.T(lang, nsEmployerSignup, "body_separate_email_note"))
	dnsInstructions := html.EscapeString(i18n.TF(lang, nsEmployerSignup, "body_dns_instructions", data))
	step1 := html.EscapeString(i18n.T(lang, nsEmployerSignup, "step1"))
	step2 := html.EscapeString(i18n.T(lang, nsEmployerSignup, "step2"))
	step3 := html.EscapeString(i18n.T(lang, nsEmployerSignup, "step3"))
	step4 := html.EscapeString(i18n.T(lang, nsEmployerSignup, "step4"))
	step5 := html.EscapeString(i18n.T(lang, nsEmployerSignup, "step5"))
	recordTypeLabel := html.EscapeString(i18n.T(lang, nsEmployerSignup, "record_type_label"))
	hostLabel := html.EscapeString(i18n.T(lang, nsEmployerSignup, "host_label"))
	valueLabel := html.EscapeString(i18n.T(lang, nsEmployerSignup, "value_label"))
	ttlLabel := html.EscapeString(i18n.T(lang, nsEmployerSignup, "ttl_label"))
	propagationNote := html.EscapeString(i18n.T(lang, nsEmployerSignup, "propagation_note"))
	expiry := html.EscapeString(i18n.TF(lang, nsEmployerSignup, "body_expiry", data))
	ignore := html.EscapeString(i18n.T(lang, nsEmployerSignup, "body_ignore"))
	footer := html.EscapeString(i18n.T(lang, nsEmployerSignup, "footer"))

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
                            <!-- Separate Email Note -->
                            <div style="background-color: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 6px; padding: 16px; margin: 0 0 24px 0;">
                                <p style="margin: 0; font-size: 14px; line-height: 20px; color: #2e7d32;">
                                    <strong>Note:</strong> %s
                                </p>
                            </div>
                            <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #666666;">
                                %s
                            </p>

                            <!-- Step-by-Step Instructions -->
                            <div style="background-color: #e8f4fd; border: 1px solid #b8daff; border-radius: 6px; padding: 20px; margin: 24px 0;">
                                <h3 style="margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #004085;">Step-by-Step Instructions</h3>
                                <ol style="margin: 0; padding-left: 20px; color: #004085;">
                                    <li style="margin-bottom: 8px; font-size: 14px; line-height: 20px;">%s</li>
                                    <li style="margin-bottom: 8px; font-size: 14px; line-height: 20px;">%s</li>
                                    <li style="margin-bottom: 8px; font-size: 14px; line-height: 20px;">%s</li>
                                    <li style="margin-bottom: 8px; font-size: 14px; line-height: 20px;">%s</li>
                                    <li style="margin-bottom: 0; font-size: 14px; line-height: 20px;">%s</li>
                                </ol>
                            </div>

                            <!-- DNS Record Box -->
                            <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 20px; margin: 24px 0;">
                                <h3 style="margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #495057;">DNS Record Details</h3>

                                <table style="width: 100%%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 8px 0; font-size: 12px; font-weight: 600; color: #6c757d; width: 120px;">%s</td>
                                        <td style="padding: 8px 0; font-size: 14px; font-family: monospace; color: #212529;">TXT</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-size: 12px; font-weight: 600; color: #6c757d;">%s</td>
                                        <td style="padding: 8px 0; font-size: 14px; font-family: monospace; color: #212529; word-break: break-all;">
                                            <code style="background-color: #fff; padding: 4px 8px; border-radius: 4px; border: 1px solid #dee2e6;">_vetchium-verify</code>
                                            <br><span style="font-size: 12px; color: #6c757d; font-family: sans-serif;">(or _vetchium-verify.%s for full hostname)</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-size: 12px; font-weight: 600; color: #6c757d;">%s</td>
                                        <td style="padding: 8px 0;">
                                            <code style="display: block; background-color: #fff; padding: 10px; border-radius: 4px; border: 1px solid #dee2e6; font-size: 13px; font-family: monospace; color: #212529; word-break: break-all;">%s</code>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; font-size: 12px; font-weight: 600; color: #6c757d;">%s</td>
                                        <td style="padding: 8px 0; font-size: 14px; font-family: monospace; color: #212529;">300 (or default)</td>
                                    </tr>
                                </table>
                            </div>

                            <!-- Propagation Note -->
                            <div style="background-color: #fff3cd; border: 1px solid #ffeeba; border-radius: 6px; padding: 16px; margin: 24px 0;">
                                <p style="margin: 0; font-size: 14px; line-height: 20px; color: #856404;">
                                    <strong>Note:</strong> %s
                                </p>
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
</html>`, htmlLang, portalName, intro, separateEmailNote, dnsInstructions,
		step1, step2, step3, step4, step5,
		recordTypeLabel, hostLabel, escapedDomain, valueLabel, escapedDNSValue, ttlLabel,
		propagationNote, expiry, ignore, footer)
}
