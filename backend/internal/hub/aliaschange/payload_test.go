package aliaschange

import (
	"testing"

	directoryspec "github.com/vetchium/src/typespec/directory"
)

func TestPayloadValidation(t *testing.T) {
	alias := directoryspec.HubAlias("new-alias")
	previous := directoryspec.HubAlias("old-alias")
	payload := Payload{
		HubUserDID:   "00000000-0000-7000-8000-000000000003",
		ProfileAlias: &alias, PreviousAlias: &previous,
		ExpectedProfileVersion: 3,
	}
	if !payload.Valid() {
		t.Fatal("valid alias change rejected")
	}
	for _, modify := range []func(*Payload){
		func(p *Payload) { p.ProfileAlias = p.PreviousAlias },
		func(p *Payload) { p.ExpectedProfileVersion = 0 },
		func(p *Payload) { p.HubUserDID = "not-a-did" },
		func(p *Payload) { invalid := directoryspec.HubAlias("api"); p.ProfileAlias = &invalid },
	} {
		invalid := payload
		modify(&invalid)
		if invalid.Valid() {
			t.Fatalf("invalid alias change accepted: %+v", invalid)
		}
	}
	withoutAlias := payload
	withoutAlias.ProfileAlias = nil
	if !withoutAlias.Valid() {
		t.Fatal("alias release rejected")
	}
}
