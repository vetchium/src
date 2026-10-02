// Package settings contains Org API settings wire types.
package settings

type LogoContentType string

const (
	LogoJPEG LogoContentType = "image/jpeg"
	LogoPNG  LogoContentType = "image/png"

	// MaxLogoBytes bounds the request body and the re-encoded image.
	MaxLogoBytes = 2 * 1024 * 1024

	// A logo's sides are each between these bounds, inclusive.
	MinLogoDimension = 128
	MaxLogoDimension = 4096
)

func IsLogoContentType(value LogoContentType) bool {
	return value == LogoJPEG || value == LogoPNG
}
