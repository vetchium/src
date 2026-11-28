package main

import (
	"testing"

	"github.com/vetchium/src/typespec/hub/posts"
)

func TestSplitPostUsersKeepsPlansAndOrder(t *testing.T) {
	fixture := []hubUserFixture{
		{Email: "a@sgp.test", Plan: "hub-free-tier"},
		{Email: "b@sgp.test", Plan: "hub-silver-tier"},
		{Email: "c@sgp.test", Plan: "hub-free-tier"},
		{Email: "d@sgp.test", Plan: "hub-silver-tier"},
	}
	silver, free := splitPostUsers("sgp", fixture)
	if len(silver) != 2 || silver[0].email != "b@sgp.test" || silver[1].email != "d@sgp.test" {
		t.Errorf("silver = %v", silver)
	}
	if len(free) != 2 || free[0].email != "a@sgp.test" || free[0].tenant != "sgp" {
		t.Errorf("free = %v", free)
	}
}

func TestSeedPostBodiesAreValid(t *testing.T) {
	bodies := append([]string{
		seedReplyBody, seedSubReplyBody, seedHiddenBody, seedQuoteBody, seedOpeningQuote,
	}, seedPostBodies[:]...)
	for _, body := range bodies {
		if !posts.IsBody(body) {
			t.Errorf("invalid body %q", body)
		}
	}
}
