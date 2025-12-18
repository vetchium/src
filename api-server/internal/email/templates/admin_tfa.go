package templates

import (
	"fmt"
	"html"
)

// AdminTFAData contains data for the admin TFA email
type AdminTFAData struct {
	Code string // 6-digit verification code
}

// AdminTFASubject returns the email subject for admin TFA
func AdminTFASubject() string {
	return "Your Vetchium Admin Verification Code"
}

// AdminTFATextBody returns the plain text body for admin TFA email
func AdminTFATextBody(data AdminTFAData) string {
	return fmt.Sprintf(`Vetchium Admin Portal - Verification Code

Your verification code is: %s

This code will expire in 10 minutes.

If you did not request this code, please ignore this email or contact support if you have concerns about your account security.

---
Vetchium Admin Portal
This is an automated message. Please do not reply.
`, data.Code)
}

// AdminTFAHTMLBody returns the HTML body for admin TFA email
func AdminTFAHTMLBody(data AdminTFAData) string {
	escapedCode := html.EscapeString(data.Code)

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="background-color: #f5f5f5;">
        <tr>
            <td style="padding: 40px 20px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%%" style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #eee;">
                            <h1 style="margin: 0; font-size: 24px; font-weight: 600; color: #1a1a1a;">Vetchium Admin Portal</h1>
                        </td>
                    </tr>
                    <!-- Content -->
                    <tr>
                        <td style="padding: 32px;">
                            <p style="margin: 0 0 24px; font-size: 16px; line-height: 24px; color: #333333;">
                                Your verification code is:
                            </p>
                            <div style="text-align: center; margin: 24px 0;">
                                <span style="display: inline-block; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; background-color: #f0f0f0; padding: 16px 32px; border-radius: 8px; font-family: 'Courier New', monospace;">%s</span>
                            </div>
                            <p style="margin: 24px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
                                This code will expire in <strong>10 minutes</strong>.
                            </p>
                            <p style="margin: 16px 0 0; font-size: 14px; line-height: 20px; color: #666666;">
                                If you did not request this code, please ignore this email or contact support if you have concerns about your account security.
                            </p>
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #eee; background-color: #fafafa; border-radius: 0 0 8px 8px;">
                            <p style="margin: 0; font-size: 12px; color: #999999;">
                                This is an automated message from Vetchium Admin Portal.<br>
                                Please do not reply to this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`, escapedCode)
}
