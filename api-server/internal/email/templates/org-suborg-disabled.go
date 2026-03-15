package templates

import (
	"fmt"
	"html"

	"vetchium-api-server.gomodule/internal/i18n"
)

const nsOrgSubOrgDisabled = "emails/org_suborg_disabled"

// OrgSubOrgDisabledData contains data for the SubOrg disabled notification email.
type OrgSubOrgDisabledData struct {
	SubOrgName   string // Display name of the disabled SubOrg
	EmployerName string // Name of the employer/organization
}

// OrgSubOrgDisabledSubject returns the localized email subject.
func OrgSubOrgDisabledSubject(lang string, data OrgSubOrgDisabledData) string {
	return i18n.TF(lang, nsOrgSubOrgDisabled, "subject", data)
}

// OrgSubOrgDisabledTextBody returns the localized plain text body.
func OrgSubOrgDisabledTextBody(lang string, data OrgSubOrgDisabledData) string {
	portalName := i18n.T(lang, nsOrgSubOrgDisabled, "portal_name")
	greeting := i18n.T(lang, nsOrgSubOrgDisabled, "body_greeting")
	intro := i18n.TF(lang, nsOrgSubOrgDisabled, "body_intro", data)
	detail := i18n.T(lang, nsOrgSubOrgDisabled, "body_detail")
	footer := i18n.T(lang, nsOrgSubOrgDisabled, "footer")

	return fmt.Sprintf(`%s

%s

%s

%s

---
%s
%s
`, portalName, greeting, intro, detail, portalName, footer)
}

// OrgSubOrgDisabledHTMLBody returns the localized HTML body.
func OrgSubOrgDisabledHTMLBody(lang string, data OrgSubOrgDisabledData) string {
	portalName := html.EscapeString(i18n.T(lang, nsOrgSubOrgDisabled, "portal_name"))
	greeting := html.EscapeString(i18n.T(lang, nsOrgSubOrgDisabled, "body_greeting"))
	intro := html.EscapeString(i18n.TF(lang, nsOrgSubOrgDisabled, "body_intro", data))
	detail := html.EscapeString(i18n.T(lang, nsOrgSubOrgDisabled, "body_detail"))
	footer := html.EscapeString(i18n.T(lang, nsOrgSubOrgDisabled, "footer"))

	htmlLang := "en"
	if len(lang) >= 2 {
		htmlLang = lang[:2]
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SubOrg Disabled</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eee;">
                            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">%s</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">%s</p>
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">%s</p>
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
</html>`, htmlLang, portalName, greeting, intro, detail, footer)
}
