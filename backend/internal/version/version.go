// Package version exposes the application version embedded at build time.
package version

// Value is overridden for release builds with -ldflags -X.
var Value = "dev"
