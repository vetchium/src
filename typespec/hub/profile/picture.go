package profile

type PictureContentType string

const (
	PictureJPEG     PictureContentType = "image/jpeg"
	PicturePNG      PictureContentType = "image/png"
	MaxPictureBytes                    = 8_388_608
)

func IsPictureContentType(value PictureContentType) bool {
	return value == PictureJPEG || value == PicturePNG
}

// The handler must cap the HTTP request before constructing this value.
type UploadPictureRequest struct {
	ContentType PictureContentType `json:"-"`
	Body        []byte             `json:"-"`
}

func (r *UploadPictureRequest) Normalize() {}

func (r UploadPictureRequest) Validate() []string {
	fields := []string{}
	if !IsPictureContentType(r.ContentType) {
		fields = append(fields, "content_type")
	}
	if len(r.Body) == 0 || len(r.Body) > MaxPictureBytes {
		fields = append(fields, "body")
	}
	return fields
}
