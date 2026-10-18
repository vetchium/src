package profile

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func validSnapshot() ApplicantSnapshot {
	return ApplicantSnapshot{
		DisplayName: "Ada Lovelace", Handle: "abcd1234-0123456789a",
		ResidentCountry: "GB",
	}.Normalized()
}

func TestApplicantSnapshotNormalizesNilArraysWithoutMutation(t *testing.T) {
	t.Parallel()
	original := ApplicantSnapshot{DisplayName: "Ada"}
	normalized := original.Normalized()
	if original.Websites != nil {
		t.Fatal("normalization mutated the caller's snapshot")
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"websites", "work_experiences", "certifications",
		"language_abilities", "educational_qualifications",
	} {
		if !strings.Contains(string(data), `"`+field+`":[]`) {
			t.Errorf("%s did not encode as []: %s", field, data)
		}
	}
	if strings.Contains(string(data), "profile_picture_url") {
		t.Fatal("a snapshot carries no picture")
	}
}

func TestApplicantSnapshotValidation(t *testing.T) {
	t.Parallel()
	if got := validSnapshot().Validate(); len(got) != 0 {
		t.Fatalf("valid snapshot rejected: %v", got)
	}
	long := ProfileLongText(strings.Repeat("é", 2001))
	bad := validSnapshot()
	bad.DisplayName, bad.Handle, bad.ResidentCountry = "", "x", "ZZ"
	bad.Biography = &long
	bad.Websites = make([]Website, MaxWebsites+1)
	bad.WorkExperiences = make([]WorkExperience, 51)
	bad.Certifications = make([]Certification, 51)
	bad.LanguageAbilities = make([]LanguageAbilityEntry, 76)
	bad.EducationalQualifications = make([]EducationalQualification, 31)
	want := []string{
		"display_name", "handle", "resident_country", "biography", "websites",
		"work_experiences", "certifications", "language_abilities",
		"educational_qualifications",
	}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
