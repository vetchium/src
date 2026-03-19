package server

// GlobalServer holds dependencies for the global service (admin HTTP handlers).
// It connects only to the global database - no regional DB access.
type GlobalServer struct {
	BaseServer
}
