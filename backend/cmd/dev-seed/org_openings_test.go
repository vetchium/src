package main

import (
	"testing"

	"github.com/vetchium/src/typespec/common"
)

// seededPublishedOpenings are the index and live title of each Opening
// seedOrgOpenings leaves published: the revised product designer, and the
// Openings whose pending pause, revise, or close keeps them published.
var seededPublishedOpenings = []struct {
	index int
	title string
}{
	{2, "Senior product designer"},
	{6, "Researcher"},
	{7, "Account manager"},
	{9, "Technical writer"},
}

func TestSeedOpeningContentIsValid(t *testing.T) {
	for _, org := range seededOrgs {
		for index := range 10 {
			for title := range seedOpeningSummaries {
				content := seedOpeningContent(org.number, index, title)
				content.Normalize()
				if fields := content.Validate(); len(fields) > 0 {
					t.Errorf("org %d index %d %q: invalid %v", org.number, index, title, fields)
				}
			}
		}
	}
}

// TestSeededPublishedOpeningsCoverEverySearchFilter keeps OPN-TST-003: each
// tenant's published seeded Openings match each search filter value and
// miss some, so a developer sees both sides of every filter.
func TestSeededPublishedOpeningsCoverEverySearchFilter(t *testing.T) {
	seen := map[string]bool{}
	localCountries := map[common.CountryCode]bool{}
	tagOrgs := map[common.OpeningTagOID]map[int]bool{}
	for _, org := range seededOrgs {
		for _, published := range seededPublishedOpenings {
			content := seedOpeningContent(org.number, published.index, published.title)
			arrangement := string(*content.WorkArrangement)
			if content.RemoteEligibility != nil {
				arrangement += " " + string(content.RemoteEligibility.Kind)
			} else {
				localCountries[*content.EmployingCountry] = true
			}
			seen["arrangement "+arrangement] = true
			seen["employment "+string(*content.EmploymentType)] = true
			seen["salary "+map[bool]string{true: "disclosed", false: "undisclosed"}[content.Salary != nil]] = true
			switch experience := content.ExperienceYears; {
			case experience == nil:
				seen["experience none"] = true
			case experience.Min != nil && experience.Max != nil:
				seen["experience closed"] = true
			case experience.Min != nil:
				seen["experience open max"] = true
			default:
				seen["experience open min"] = true
			}
			if content.MinimumEducation == nil {
				seen["education none"] = true
			} else {
				seen["education "+string(*content.MinimumEducation)] = true
			}
			for _, tag := range content.Tags {
				if tagOrgs[tag] == nil {
					tagOrgs[tag] = map[int]bool{}
				}
				tagOrgs[tag][org.number] = true
			}
		}
	}
	for _, want := range []string{
		"arrangement on_site", "arrangement hybrid",
		"arrangement remote worldwide", "arrangement remote countries",
		"employment full_time", "employment part_time",
		"employment contract", "employment internship",
		"salary disclosed", "salary undisclosed",
		"experience none", "experience closed",
		"experience open max", "experience open min",
		"education none", "education secondary", "education bachelor",
		"education master", "education doctorate",
	} {
		if !seen[want] {
			t.Errorf("no published seeded Opening has %s", want)
		}
	}
	if len(localCountries) < 2 {
		t.Errorf("on-site and hybrid Openings employ in %d countries, want at least 2", len(localCountries))
	}
	shared := false
	for _, orgsWithTag := range tagOrgs {
		shared = shared || len(orgsWithTag) > 1
	}
	if !shared {
		t.Error("no tag is shared between seeded Orgs")
	}
}
