package authorization

// PermissionDescriptor is one catalog permission and what a direct grant of
// it also confers.
type PermissionDescriptor struct {
	Permission OrgPermissionID   `json:"permission"`
	Implies    []OrgPermissionID `json:"implies"`
}

type ListPermissionsResponse struct {
	Permissions []PermissionDescriptor `json:"permissions"`
}
