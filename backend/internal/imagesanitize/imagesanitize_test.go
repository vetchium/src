package imagesanitize

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// logo mirrors the Org logo limits the handler passes.
var logo = Limits{
	MaxBytes: 2 * 1024 * 1024, MinDimension: 128,
	MaxLongSide: 4096, MaxShortSide: 4096, MaxPixels: 4096 * 4096,
}

func encode(t *testing.T, contentType string, width, height int) []byte {
	t.Helper()
	pixels := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			pixels.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}
	var output bytes.Buffer
	var err error
	if contentType == JPEG {
		err = jpeg.Encode(&output, pixels, nil)
	} else {
		err = png.Encode(&output, pixels)
	}
	if err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestSanitizeAcceptsLogoSizesAndKeepsTheFormat(t *testing.T) {
	t.Parallel()
	for _, contentType := range []string{JPEG, PNG} {
		for _, side := range []int{128, 300} {
			image, err := Sanitize(logo, contentType, encode(t, contentType, side, side))
			if err != nil {
				t.Fatalf("%s %d: %v", contentType, side, err)
			}
			if image.ContentType != contentType || image.Width != side ||
				image.Height != side || len(image.Bytes) == 0 {
				t.Fatalf("image = %+v", image)
			}
		}
	}
}

func TestSanitizeRejectsOutOfBoundsAndDisguisedInput(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name        string
		contentType string
		source      []byte
		want        error
	}{
		{"too small", PNG, encode(t, PNG, 127, 200), ErrInvalidImage},
		{"too small on the other side", PNG, encode(t, PNG, 200, 127), ErrInvalidImage},
		{"png sent as jpeg", JPEG, encode(t, PNG, 200, 200), ErrInvalidImage},
		{"jpeg sent as png", PNG, encode(t, JPEG, 200, 200), ErrInvalidImage},
		{"empty", PNG, nil, ErrInvalidImage},
		{"garbage", PNG, []byte("not an image at all"), ErrInvalidImage},
		{"unknown type", "image/gif", encode(t, PNG, 200, 200), ErrInvalidImage},
		{"over the byte limit", PNG, make([]byte, logo.MaxBytes+1), ErrTooLarge},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			_, err := Sanitize(logo, testCase.contentType, testCase.source)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("Sanitize() error = %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestLogoDimensionBounds(t *testing.T) {
	t.Parallel()
	for _, testCase := range []struct {
		width, height int
		valid         bool
	}{
		{128, 128, true},
		{4096, 4096, true},
		{4096, 128, true},
		{127, 4096, false},
		{4097, 4096, false},
		{4096, 4097, false},
	} {
		if got := ValidDimensions(logo, testCase.width, testCase.height); got != testCase.valid {
			t.Errorf("%dx%d valid = %t, want %t", testCase.width, testCase.height, got, testCase.valid)
		}
	}
}
