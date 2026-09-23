package profile

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	profilespec "github.com/vetchium/src/typespec/hub/profile"

	"backend/internal/apiserver"
	hubruntime "backend/internal/hub"
	"backend/internal/profilepicture"
)

type uploadPictureStoreStub struct {
	putCount int
}

func (s *uploadPictureStoreStub) Put(
	context.Context, pgtype.UUID, profilepicture.Sanitized,
) error {
	s.putCount++
	return nil
}

func TestPictureUploadRejectsOversizeBeforeDecoding(t *testing.T) {
	store := &uploadPictureStoreStub{}
	server := &hubruntime.Server{
		Runtime:  apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Pictures: store,
	}
	for _, unknownLength := range []bool{false, true} {
		request := httptest.NewRequest(http.MethodPost, "/api/hub/profile/picture/upload",
			bytes.NewReader(make([]byte, profilespec.MaxPictureBytes+1)))
		request.Header.Set("Content-Type", "image/jpeg")
		request.Header.Set("Idempotency-Key", "picture-test-key-123456")
		if unknownLength {
			request.ContentLength = -1
		}
		response := httptest.NewRecorder()
		UploadPicture(server)(response, request)
		if response.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("unknown length=%t: status=%d body=%s",
				unknownLength, response.Code, response.Body.String())
		}
	}
	if store.putCount != 0 {
		t.Fatal("oversized request reached object storage")
	}
}

func TestPictureUploadRejectsDisguisedContentBeforeDatabase(t *testing.T) {
	store := &uploadPictureStoreStub{}
	server := &hubruntime.Server{
		Runtime:  apiserver.New(nil, slog.New(slog.NewTextHandler(io.Discard, nil))),
		Pictures: store,
	}
	request := httptest.NewRequest(http.MethodPost, "/api/hub/profile/picture/upload",
		bytes.NewReader([]byte("not a JPEG")))
	request.Header.Set("Content-Type", "image/jpeg")
	request.Header.Set("Idempotency-Key", "picture-test-key-123456")
	response := httptest.NewRecorder()
	UploadPicture(server)(response, request)
	if response.Code != http.StatusBadRequest || store.putCount != 0 {
		t.Fatalf("invalid image status=%d puts=%d", response.Code, store.putCount)
	}
}

func TestPictureObjectIdentifierAndRequestDigest(t *testing.T) {
	secret := [32]byte{1, 2, 3}
	did := pgtype.UUID{Bytes: [16]byte{4, 5, 6}, Valid: true}
	key := common.IdempotencyKey("picture-key")
	id := pictureObjectID(secret, did, key)
	if !id.Valid || id.Bytes[6]>>4 != 4 || id.Bytes[8]>>6 != 2 ||
		id != pictureObjectID(secret, did, key) {
		t.Fatalf("object id is not stable and UUID-shaped: %+v", id)
	}
	if id == pictureObjectID(secret, did, "other-key") {
		t.Fatal("different idempotency keys share an object id")
	}
	if id == pictureObjectID([32]byte{9}, did, key) {
		t.Fatal("changing the secret did not change the object id")
	}
	digest := pictureRequestDigest(profilespec.PictureJPEG, []byte("bytes"))
	if digest == pictureRequestDigest(profilespec.PicturePNG, []byte("bytes")) ||
		digest == pictureRequestDigest(profilespec.PictureJPEG, []byte("other")) {
		t.Fatal("request digest did not bind content type and bytes")
	}
}
