package profilepicture

import (
	"backend/internal/imagesanitize"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
)

// limits are PROF-PIC-003 and PROF-PIC-004.
var limits = imagesanitize.Limits{
	MaxBytes:     profilespec.MaxPictureBytes,
	MinDimension: 400,
	MaxLongSide:  7_680,
	MaxShortSide: 4_320,
	MaxPixels:    33_177_600,
}

var (
	ErrInvalidImage = imagesanitize.ErrInvalidImage
	ErrTooLarge     = imagesanitize.ErrTooLarge
)

type Sanitized struct {
	Bytes       []byte
	ContentType profilespec.PictureContentType
	Width       int
	Height      int
	SHA256      [32]byte
}

// Sanitize stores only the decoded pixels, never source metadata or source
// bytes. The HTTP layer must also bound the request before reading its body.
func Sanitize(contentType profilespec.PictureContentType, source []byte) (Sanitized, error) {
	image, err := imagesanitize.Sanitize(limits, string(contentType), source)
	if err != nil {
		return Sanitized{}, err
	}
	return Sanitized{
		Bytes: image.Bytes, ContentType: contentType, Width: image.Width,
		Height: image.Height, SHA256: image.SHA256,
	}, nil
}
