package templates

import "fmt"

// HubConnectionRequestData contains data for the hub connection request email
type HubConnectionRequestData struct {
	RequesterName string
}

// HubConnectionRequestSubject returns the email subject for a connection request notification
func HubConnectionRequestSubject() string {
	return "New Connection Request on Vetchium"
}

// HubConnectionRequestTextBody returns the plain text body for a connection request email
func HubConnectionRequestTextBody(data HubConnectionRequestData) string {
	return fmt.Sprintf(`You have a new connection request on Vetchium.

%s has sent you a connection request.

Log in to your Vetchium account to accept or reject this request.

---
Vetchium
`, data.RequesterName)
}

// HubConnectionRequestHTMLBody returns the HTML body for a connection request email
func HubConnectionRequestHTMLBody(data HubConnectionRequestData) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Connection Request</title>
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
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                You have a new connection request on Vetchium.
                            </p>
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                <strong>%s</strong> has sent you a connection request.
                            </p>
                            <p style="margin: 0; font-size: 14px; line-height: 20px; color: #666666;">
                                Log in to your Vetchium account to accept or reject this request.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #eee; background-color: #fafafa; border-radius: 0 0 8px 8px;">
                            <p style="margin: 0; font-size: 12px; color: #999999;">Vetchium</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`, data.RequesterName)
}

// HubConnectionAcceptedData contains data for the connection accepted email
type HubConnectionAcceptedData struct {
	AccepterName string
}

// HubConnectionAcceptedSubject returns the email subject for a connection accepted notification
func HubConnectionAcceptedSubject() string {
	return "Connection Request Accepted on Vetchium"
}

// HubConnectionAcceptedTextBody returns the plain text body for a connection accepted email
func HubConnectionAcceptedTextBody(data HubConnectionAcceptedData) string {
	return fmt.Sprintf(`Your connection request has been accepted on Vetchium.

%s has accepted your connection request. You are now connected.

---
Vetchium
`, data.AccepterName)
}

// HubConnectionAcceptedHTMLBody returns the HTML body for a connection accepted email
func HubConnectionAcceptedHTMLBody(data HubConnectionAcceptedData) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connection Accepted</title>
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
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                Your connection request has been accepted on Vetchium.
                            </p>
                            <p style="margin: 0 0 16px; font-size: 16px; line-height: 24px; color: #333333;">
                                <strong>%s</strong> has accepted your connection request. You are now connected.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 24px 32px; text-align: center; border-top: 1px solid #eee; background-color: #fafafa; border-radius: 0 0 8px 8px;">
                            <p style="margin: 0; font-size: 12px; color: #999999;">Vetchium</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`, data.AccepterName)
}
