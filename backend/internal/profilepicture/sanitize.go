package profilepicture

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
)

const (
	minimumDimension = 400
	maximumLongSide  = 7_680
	maximumShortSide = 4_320
	maximumPixels    = 33_177_600
)

var (
	ErrInvalidImage = errors.New("invalid profile picture")
	ErrTooLarge     = errors.New("profile picture exceeds 8 MiB")
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
	if len(source) > profilespec.MaxPictureBytes {
		return Sanitized{}, ErrTooLarge
	}
	if len(source) == 0 || !profilespec.IsPictureContentType(contentType) {
		return Sanitized{}, ErrInvalidImage
	}
	if contentType == profilespec.PicturePNG {
		animated, err := animatedPNG(source)
		if err != nil || animated {
			return Sanitized{}, ErrInvalidImage
		}
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(source))
	if err != nil || !matchesContentType(contentType, format) ||
		!validDimensions(config.Width, config.Height) {
		return Sanitized{}, ErrInvalidImage
	}
	decoded, actualFormat, err := image.Decode(bytes.NewReader(source))
	if err != nil || !matchesContentType(contentType, actualFormat) ||
		decoded.Bounds().Dx() != config.Width ||
		decoded.Bounds().Dy() != config.Height {
		return Sanitized{}, ErrInvalidImage
	}
	var output bytes.Buffer
	switch contentType {
	case profilespec.PictureJPEG:
		err = jpeg.Encode(&output, decoded, &jpeg.Options{Quality: 90})
	case profilespec.PicturePNG:
		err = png.Encode(&output, decoded)
	default:
		return Sanitized{}, ErrInvalidImage
	}
	if err != nil {
		return Sanitized{}, fmt.Errorf("encode profile picture: %w", err)
	}
	if output.Len() > profilespec.MaxPictureBytes {
		return Sanitized{}, ErrTooLarge
	}
	result := Sanitized{
		Bytes: output.Bytes(), ContentType: contentType,
		Width: config.Width, Height: config.Height,
	}
	result.SHA256 = sha256.Sum256(result.Bytes)
	return result, nil
}

func validDimensions(width, height int) bool {
	if width < minimumDimension || height < minimumDimension {
		return false
	}
	longSide, shortSide := max(width, height), min(width, height)
	return longSide <= maximumLongSide && shortSide <= maximumShortSide &&
		int64(width)*int64(height) <= maximumPixels
}

func matchesContentType(contentType profilespec.PictureContentType, format string) bool {
	return (contentType == profilespec.PictureJPEG && format == "jpeg") ||
		(contentType == profilespec.PicturePNG && format == "png")
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
