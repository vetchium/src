package postread

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
)

const validID = "0123456789abcdefghij0123456789abcdefghij"

func TestKeyRoundTrip(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 11, 28, 1, 2, 3, 456789000, time.UTC)
	key, err := encodeKey(cursor{At: at, PostID: validID})
	if err != nil {
		t.Fatal(err)
	}
	if !common.IsPaginationKey(key) {
		t.Fatalf("key %q is not a pagination key", key)
	}
	got, err := decodeKey(key)
	if err != nil || !got.At.Equal(at) || got.PostID != validID {
		t.Fatalf("decodeKey = %+v, %v", got, err)
	}
}

func TestDecodeKeyRefusesForgedKeys(t *testing.T) {
	t.Parallel()
	for _, key := range []common.PaginationKey{
		"not base64 !", "e30", "bnVsbA",
		common.PaginationKey(strings.Repeat("A", 40)),
	} {
		if _, err := decodeKey(key); !errors.Is(err, ErrInvalidKey) {
			t.Errorf("decodeKey(%q) error = %v, want ErrInvalidKey", key, err)
		}
	}
}
