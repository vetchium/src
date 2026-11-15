package profile

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/hub"
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

func TestApplicantSnapshotNormalizesIdealJobWithoutMutation(t *testing.T) {
	t.Parallel()
	text := hub.IdealJob("  Backend work\nremote first \t")
	original := ApplicantSnapshot{IdealJob: &text}
	normalized := original.Normalized()
	if *original.IdealJob != "  Backend work\nremote first \t" {
		t.Fatal("normalization mutated the caller's ideal job")
	}
	if normalized.IdealJob == nil ||
		*normalized.IdealJob != "Backend work\nremote first" {
		t.Fatalf("ideal job = %v", normalized.IdealJob)
	}
	blank := hub.IdealJob(" \n\t ")
	if got := (ApplicantSnapshot{IdealJob: &blank}).Normalized(); got.IdealJob != nil {
		t.Fatalf("blank ideal job kept: %q", *got.IdealJob)
	}
	data, err := json.Marshal(validSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "ideal_job") {
		t.Fatalf("absent ideal job encoded: %s", data)
	}
}

func TestApplicantSnapshotValidation(t *testing.T) {
	t.Parallel()
	if got := validSnapshot().Validate(); len(got) != 0 {
		t.Fatalf("valid snapshot rejected: %v", got)
	}
	longest := hub.IdealJob(strings.Repeat("😀", hub.MaxIdealJobCodePoints))
	withIdealJob := validSnapshot()
	withIdealJob.IdealJob = &longest
	if got := withIdealJob.Validate(); len(got) != 0 {
		t.Fatalf("ideal job at the limit rejected: %v", got)
	}
	tooLong := longest + "x"
	long := ProfileLongText(strings.Repeat("é", 2001))
	bad := validSnapshot()
	bad.DisplayName, bad.Handle, bad.ResidentCountry = "", "x", "ZZ"
	bad.Biography = &long
	bad.Websites = make([]Website, MaxWebsites+1)
	bad.WorkExperiences = make([]WorkExperience, 51)
	bad.Certifications = make([]Certification, 51)
	bad.LanguageAbilities = make([]LanguageAbilityEntry, 76)
	bad.EducationalQualifications = make([]EducationalQualification, 31)
	bad.IdealJob = &tooLong
	want := []string{
		"display_name", "handle", "resident_country", "biography", "websites",
		"work_experiences", "certifications", "language_abilities",
		"educational_qualifications", "ideal_job",
	}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}
