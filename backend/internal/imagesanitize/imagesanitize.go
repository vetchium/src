// Package imagesanitize decodes an uploaded still image within explicit
// limits and re-encodes it once, so only decoded pixels are stored: no source
// metadata and no source bytes.
package imagesanitize

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
)

const (
	JPEG = "image/jpeg"
	PNG  = "image/png"
)

var (
	ErrInvalidImage = errors.New("invalid image")
	ErrTooLarge     = errors.New("image is too large")
)

// Limits bound an upload. Both sides are at least MinDimension; the longer is
// at most MaxLongSide, the shorter at most MaxShortSide, and the area at most
// MaxPixels. MaxBytes bounds the source and the re-encoded result.
type Limits struct {
	MaxBytes     int
	MinDimension int
	MaxLongSide  int
	MaxShortSide int
	MaxPixels    int64
}

type Image struct {
	Bytes       []byte
	ContentType string
	Width       int
	Height      int
	SHA256      [32]byte
}

// Sanitize stores only the decoded pixels. The HTTP layer must also bound the
// request before reading its body.
func Sanitize(limits Limits, contentType string, source []byte) (Image, error) {
	if len(source) > limits.MaxBytes {
		return Image{}, ErrTooLarge
	}
	if len(source) == 0 || (contentType != JPEG && contentType != PNG) {
		return Image{}, ErrInvalidImage
	}
	if contentType == PNG {
		animated, err := animatedPNG(source)
		if err != nil || animated {
			return Image{}, ErrInvalidImage
		}
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil || !matchesContentType(contentType, format) ||
		!ValidDimensions(limits, config.Width, config.Height) {
		return Image{}, ErrInvalidImage
	}
	decoded, actualFormat, err := image.Decode(bytes.NewReader(source))
	if err != nil || !matchesContentType(contentType, actualFormat) ||
		decoded.Bounds().Dx() != config.Width ||
		decoded.Bounds().Dy() != config.Height {
		return Image{}, ErrInvalidImage
	}
	var output bytes.Buffer
	switch contentType {
	case JPEG:
		err = jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 90})
	default:
		err = png.Encode(&output, decoded)
	}
	if err != nil {
		return Image{}, fmt.Errorf("encode image: %w", err)
	}
	if output.Len() > limits.MaxBytes {
		return Image{}, ErrTooLarge
	}
	result := Image{
		Bytes: output.Bytes(), ContentType: contentType,
		Width: config.Width, Height: config.Height,
	}
	result.SHA256 = sha256.Sum256(result.Bytes)
	return result, nil
}

// ValidDimensions reports whether a width and height fit the limits.
func ValidDimensions(limits Limits, width, height int) bool {
	if width < limits.MinDimension || height < limits.MinDimension {
		return false
	}
	longSide, shortSide := max(width, height), min(width, height)
	return longSide <= limits.MaxLongSide && shortSide <= limits.MaxShortSide &&
		int64(width)*int64(height) <= limits.MaxPixels
}

func matchesContentType(contentType, format string) bool {
	return (contentType == JPEG && format == "jpeg") ||
		(contentType == PNG && format == "png")
}

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// The standard PNG decoder ignores APNG control chunks, which would otherwise
// make an animated upload appear to be an ordinary still image.
func animatedPNG(source []byte) (bool, error) {
	if !bytes.HasPrefix(source, pngSignature) {
		return false, ErrInvalidImage
	}
	for offset := len(pngSignature); offset < len(source); {
		if len(source)-offset < 12 {
			return false, ErrInvalidImage
		}
		length := int64(binary.BigEndian.Uint32(source[offset : offset+4]))
		if length > int64(len(source)-offset-12) {
			return false, ErrInvalidImage
		}
		chunkType := string(source[offset+4 : offset+8])
		if chunkType == "acTL" || chunkType == "fcTL" || chunkType == "fdAT" {
			return true, nil
		}
		offset += int(length) + 12
		if chunkType == "IEND" {
			return false, nil
		}
	}
	return false, ErrInvalidImage
}
