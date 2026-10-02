package profilepicture

import (
	"backend/internal/imagesanitize"
	"bytes"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"

	profilespec "github.com/vetchium/src/typespec/hub/profile"
)

func TestSanitizeJPEGStripsMetadata(t *testing.T) {
	original := encodeTestImage(t, profilespec.PictureJPEG)
	secret := []byte("Exif\x00\x00private-camera-metadata")
	withEXIF := append([]byte{}, original[:2]...)
	withEXIF = append(withEXIF, 0xff, 0xe1,
		byte((len(secret)+2)>>8), byte(len(secret)+2))
	withEXIF = append(withEXIF, secret...)
	withEXIF = append(withEXIF, original[2:]...)

	result, err := Sanitize(profilespec.PictureJPEG, withEXIF)
	if err != nil {
		t.Fatal(err)
	}
	assertSanitized(t, result, profilespec.PictureJPEG)
	if bytes.Contains(result.Bytes, secret) {
		t.Fatal("JPEG metadata survived sanitization")
	}
}

func TestSanitizePNGStripsMetadataAndRejectsAnimation(t *testing.T) {
	original := encodeTestImage(t, profilespec.PicturePNG)
	secret := []byte("Comment\x00private-camera-metadata")
	withText := insertPNGChunk(original, "tEXt", secret)
	result, err := Sanitize(profilespec.PicturePNG, withText)
	if err != nil {
		t.Fatal(err)
	}
	assertSanitized(t, result, profilespec.PicturePNG)
	if bytes.Contains(result.Bytes, secret) {
		t.Fatal("PNG metadata survived sanitization")
	}
	animated := insertPNGChunk(original, "acTL", make([]byte, 8))
	if _, err := Sanitize(profilespec.PicturePNG, animated); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("APNG error = %v", err)
	}
}

func TestSanitizeRejectsOversizeDisguisedAndMalformedInputs(t *testing.T) {
	if _, err := Sanitize(profilespec.PictureJPEG,
		make([]byte, profilespec.MaxPictureBytes+1)); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("oversize error = %v", err)
	}
	jpegBytes := encodeTestImage(t, profilespec.PictureJPEG)
	if _, err := Sanitize(profilespec.PicturePNG, jpegBytes); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("disguised JPEG error = %v", err)
	}
	pngBytes := encodeTestImage(t, profilespec.PicturePNG)
	if _, err := Sanitize(profilespec.PictureJPEG, pngBytes); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("disguised PNG error = %v", err)
	}
	if _, err := Sanitize(profilespec.PicturePNG, pngBytes[:len(pngBytes)-5]); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("truncated PNG error = %v", err)
	}
	if _, err := Sanitize("image/gif", jpegBytes); !errors.Is(err, ErrInvalidImage) {
		t.Fatalf("unsupported format error = %v", err)
	}
}

func TestValidDimensions(t *testing.T) {
	for _, dimensions := range []struct {
		width, height int
		valid         bool
	}{
		{400, 400, true},
		{7680, 4320, true},
		{399, 400, false},
		{400, 399, false},
		{7681, 400, false},
		{4321, 400, true},
		{7680, 4321, false},
		{6000, 6000, false},
	} {
		if imagesanitize.ValidDimensions(limits, dimensions.width, dimensions.height) != dimensions.valid {
			t.Errorf("dimensions %dx%d: expected valid=%t",
				dimensions.width, dimensions.height, dimensions.valid)
		}
	}
}

func encodeTestImage(t *testing.T, contentType profilespec.PictureContentType) []byte {
	t.Helper()
	pixels := image.NewRGBA(image.Rect(0, 0, 400, 400))
	for y := range 400 {
		for x := range 400 {
			pixels.Set(x, y, color.RGBA{R: 18, G: 90, B: 200, A: 255})
		}
	}
	var output bytes.Buffer
	var err error
	if contentType == profilespec.PictureJPEG {
		err = jpeg.Encode(&output, pixels, nil)
	} else {
		err = png.Encode(&output, pixels)
	}
	if err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func insertPNGChunk(original []byte, chunkType string, payload []byte) []byte {
	chunk := make([]byte, 12+len(payload))
	binary.BigEndian.PutUint32(chunk[:4], uint32(len(payload)))
	copy(chunk[4:8], chunkType)
	copy(chunk[8:], payload)
	binary.BigEndian.PutUint32(chunk[8+len(payload):], crc32.ChecksumIEEE(chunk[4:8+len(payload)]))
	const afterIHDR = 8 + 12 + 13
	modified := append([]byte{}, original[:afterIHDR]...)
	modified = append(modified, chunk...)
	return append(modified, original[afterIHDR:]...)
}

func assertSanitized(t *testing.T, result Sanitized, contentType profilespec.PictureContentType) {
	t.Helper()
	if result.ContentType != contentType || result.Width != 400 || result.Height != 400 ||
		len(result.Bytes) == 0 || len(result.Bytes) > profilespec.MaxPictureBytes {
		t.Fatalf("unexpected sanitized image: type=%s dimensions=%dx%d size=%d",
			result.ContentType, result.Width, result.Height, len(result.Bytes))
	}
	if _, _, err := image.Decode(bytes.NewReader(result.Bytes)); err != nil {
		t.Fatalf("sanitized image cannot be decoded: %v", err)
	}
}
