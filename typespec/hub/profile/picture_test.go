package profile

import (
	"slices"
	"testing"
)

func TestUploadPictureContractBounds(t *testing.T) {
	t.Parallel()
	valid := UploadPictureRequest{
		ContentType: PictureJPEG,
		Body:        []byte{0xff},
	}
	if fields := valid.Validate(); len(fields) != 0 {
		t.Fatalf("valid wire envelope rejected: %v", fields)
	}
	invalid := UploadPictureRequest{
		ContentType: "image/gif",
		Body:        make([]byte, MaxPictureBytes+1),
	}
	if got := invalid.Validate(); !slices.Equal(got, []string{
		"content_type", "body",
	}) {
		t.Fatalf("invalid wire envelope fields = %v", got)
	}
}
