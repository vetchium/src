package openingtags

import (
	"reflect"
	"testing"

	"github.com/vetchium/src/typespec/common"

	"backend/internal/db/sqlc"
)

func TestFromRows(t *testing.T) {
	t.Parallel()
	got, err := fromRows([]sqlc.ListOpeningTagsRow{
		{
			TagOid: "artificial-intelligence", DisplayName: "AI",
			LocalizedNames: []byte(`{"de":"Künstliche Intelligenz"}`),
		},
		{
			TagOid: "golang", DisplayName: "Go", Deprecated: true,
			LocalizedNames: []byte(`{}`),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := common.ListOpeningTagsResponse{Tags: []common.OpeningTag{
		{
			TagOID: "artificial-intelligence", DisplayName: "AI",
			LocalizedNames: map[string]string{"de": "Künstliche Intelligenz"},
		},
		{
			TagOID: "golang", DisplayName: "Go",
			LocalizedNames: map[string]string{}, Deprecated: true,
		},
	}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("fromRows = %+v, want %+v", got, want)
	}
}

func TestFromRowsEmptyCatalog(t *testing.T) {
	t.Parallel()
	got, err := fromRows(nil)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tags == nil || len(got.Tags) != 0 {
		t.Errorf("fromRows(nil).Tags = %#v, want empty", got.Tags)
	}
}

func TestFromRowsRefusesMalformedNames(t *testing.T) {
	t.Parallel()
	_, err := fromRows([]sqlc.ListOpeningTagsRow{
		{TagOid: "golang", DisplayName: "Go", LocalizedNames: []byte(`[]`)},
	})
	if err == nil {
		t.Error("fromRows accepted a localized_names array")
	}
}
