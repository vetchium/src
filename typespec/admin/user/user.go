// Package user contains the admin portal's user types.
package user

type State string

const (
	Active   State = "active"
	Disabled State = "disabled"
)
