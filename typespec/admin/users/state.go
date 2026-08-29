package users

type AdminUserState string

const (
	Active   AdminUserState = "active"
	Disabled AdminUserState = "disabled"
)

func IsAdminUserState(value AdminUserState) bool {
	return value == Active || value == Disabled
}
