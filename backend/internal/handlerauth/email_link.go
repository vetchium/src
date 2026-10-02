package handlerauth

import "net/url"

// EmailLink builds an emailed link to a page of the global portal at
// baseURL. The portal is shared by every region, so the link names the
// region that must handle it; token is omitted when empty.
func EmailLink(baseURL, path, tenantID, token string) string {
	query := url.Values{"region": {tenantID}}
	if token != "" {
		query.Set("token", token)
	}
	return baseURL + path + "?" + query.Encode()
}
