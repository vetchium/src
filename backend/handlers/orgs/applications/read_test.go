package applications

import (
	"testing"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/orgs/applications"
)

func TestFiltersHashExcludesPagePositionAndBindsFilters(t *testing.T) {
	t.Parallel()
	query := applications.ApplicantNameQuery("ada")
	request := applications.ListApplicationsRequest{
		OpeningNumber: 1, View: applications.CandidatesView, NameQuery: &query,
	}
	initial, err := filtersHash(request)
	if err != nil {
		t.Fatal(err)
	}
	limit, key := common.PageSize(2), common.PaginationKey("cursor")
	request.Limit, request.PaginationKey = &limit, &key
	continued, err := filtersHash(request)
	if err != nil {
		t.Fatal(err)
	}
	if initial != continued {
		t.Fatal("page position changed the filter binding")
	}
	for name, change := range map[string]func(*applications.ListApplicationsRequest){
		"view": func(r *applications.ListApplicationsRequest) { r.View = applications.ApplicantsView },
		"states": func(r *applications.ListApplicationsRequest) {
			r.States = []applications.ApplicationState{applications.Joined}
		},
		"opening": func(r *applications.ListApplicationsRequest) { r.OpeningNumber = 2 },
		"pending action": func(r *applications.ListApplicationsRequest) {
			action := applications.InterviewResponseAction
			r.PendingApplicantAction = &action
		},
		"name": func(r *applications.ListApplicationsRequest) {
			other := applications.ApplicantNameQuery("bob")
			r.NameQuery = &other
		},
	} {
		changed := request
		change(&changed)
		hash, err := filtersHash(changed)
		if err != nil {
			t.Fatal(err)
		}
		if hash == initial {
			t.Errorf("a different %s shares a pagination binding", name)
		}
	}
}

func TestDefaultCandidateStatesAreTheLiveCandidacies(t *testing.T) {
	t.Parallel()
	for _, state := range defaultCandidateStates {
		if !applications.IsCandidacy(applications.ApplicationState(state)) {
			t.Errorf("%s is not a candidacy", state)
		}
	}
	if len(defaultCandidateStates) != 3 {
		t.Fatalf("default states = %v", defaultCandidateStates)
	}
}
