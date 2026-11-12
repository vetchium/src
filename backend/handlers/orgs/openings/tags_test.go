package openings

import (
	"slices"
	"testing"
)

func TestUnknownTagsNamesEachOID(t *testing.T) {
	t.Parallel()
	if details, err := unknownTags([]byte(`[]`)); err != nil || details != nil {
		t.Fatalf("details = %v, err = %v", details, err)
	}
	details, err := unknownTags([]byte(`["no-such-tag", "another-missing"]`))
	if err != nil || details == nil ||
		details.Type != "vetchium-problem-details/org-opening-tag-unknown" ||
		details.Status != 422 ||
		!slices.Equal(details.TagOIDs, []string{"no-such-tag", "another-missing"}) {
		t.Fatalf("details = %+v, err = %v", details, err)
	}
	if _, err := unknownTags([]byte(`{`)); err == nil {
		t.Fatal("malformed OIDs decoded")
	}
}
