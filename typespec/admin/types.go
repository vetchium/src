package admin

type AdminUserID string
type HubSignupDomainID string

func IsAdminUserID(value AdminUserID) bool {
	return isUUID(string(value))
}

func IsHubSignupDomainID(value HubSignupDomainID) bool {
	return isUUID(string(value))
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') ||
				(character >= 'a' && character <= 'f') ||
				(character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}
