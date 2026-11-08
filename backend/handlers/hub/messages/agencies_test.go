package messages

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	federationspec "github.com/vetchium/src/typespec/federation"
	hubmessages "github.com/vetchium/src/typespec/hub/messages"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/db/sqlc"
)

func TestAgencyChatState(t *testing.T) {
	now := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)
	opening := contacts.OpeningSuggestion{ConsumerDomain: "client.test", OpeningNumber: 3}
	later := now.Add(time.Hour)
	earlier := now.Add(-time.Hour)
	opened := contacts.DeclineOpening
	sender := contacts.DeclineSender
	request := func(
		direction contacts.ChatRequestDirection, state contacts.ChatRequestState,
		number int32, scope *contacts.ChatRequestDeclineScope, until *time.Time,
	) []byte {
		body, err := json.Marshal(federationspec.AgencyPointerRequest{
			RequestNumber: 1, Direction: direction,
			State: state, ConsumerDomain: "client.test", OpeningNumber: openings.OpeningNumber(number),
			SentAt: earlier, DeclineScope: scope, BlockedUntil: until,
		})
		if err != nil {
			t.Fatal(err)
		}
		return body
	}
	writable := pgtype.Timestamptz{Time: later, Valid: true}
	lapsed := pgtype.Timestamptz{Time: earlier, Valid: true}
	tests := []struct {
		name    string
		pointer *sqlc.ListHubAgencyPointersForAgenciesRow
		want    hubmessages.OpeningAgencyChatState
		refusal string
	}{
		{"no pointer", nil, hubmessages.OpeningAgencyNone, ""},
		{"sent", &sqlc.ListHubAgencyPointersForAgenciesRow{
			Request: request(contacts.ToAgency, contacts.ChatRequestPending, 3, nil, nil),
		}, hubmessages.OpeningAgencyRequestSent, hubproblem.HubChatRequestExistsError.Type},
		{"received", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: lapsed,
			Request: request(contacts.ToHubUser, contacts.ChatRequestPending, 9, nil, nil),
		}, hubmessages.OpeningAgencyRequestReceived, hubproblem.HubChatRequestExistsError.Type},
		{"open", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: writable,
		}, hubmessages.OpeningAgencyOpen, hubproblem.HubConversationOpenError.Type},
		{"deleted party is closed", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: writable,
			ReadOnlyReason: pgtype.Text{String: "agency_deleted", Valid: true},
		}, hubmessages.OpeningAgencyClosed, hubproblem.HubConversationPartyDeletedError.Type},
		{"lapsed", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: lapsed,
		}, hubmessages.OpeningAgencyClosed, ""},
		{"declined for this Opening", &sqlc.ListHubAgencyPointersForAgenciesRow{
			Request: request(contacts.ToAgency, contacts.ChatRequestDeclined, 3, &opened, nil),
		}, hubmessages.OpeningAgencyDeclined, hubproblem.HubChatRequestBlockedError.Type},
		{"declined for another Opening", &sqlc.ListHubAgencyPointersForAgenciesRow{
			Request: request(contacts.ToAgency, contacts.ChatRequestDeclined, 4, &opened, nil),
		}, hubmessages.OpeningAgencyNone, ""},
		{"sender declined until later", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: lapsed,
			Request: request(contacts.ToAgency, contacts.ChatRequestDeclined, 4, &sender, &later),
		}, hubmessages.OpeningAgencyDeclined, hubproblem.HubChatRequestBlockedError.Type},
		{"sender decline lifted", &sqlc.ListHubAgencyPointersForAgenciesRow{
			Request: request(contacts.ToAgency, contacts.ChatRequestDeclined, 4, &sender, &earlier),
		}, hubmessages.OpeningAgencyNone, ""},
		{"the Hub user's own decline", &sqlc.ListHubAgencyPointersForAgenciesRow{
			Request: request(contacts.ToHubUser, contacts.ChatRequestDeclined, 3, &opened, nil),
		}, hubmessages.OpeningAgencyNone, ""},
		{"agency deleted", &sqlc.ListHubAgencyPointersForAgenciesRow{
			HasConversation: true, HubMayWriteUntil: writable,
			ReadOnlyReason: pgtype.Text{String: "agency_deleted", Valid: true},
		}, hubmessages.OpeningAgencyClosed, hubproblem.HubConversationPartyDeletedError.Type},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			chat, err := newAgencyChat(test.pointer)
			if err != nil {
				t.Fatal(err)
			}
			if got := chat.state(opening, now); got != test.want {
				t.Fatalf("state = %q, want %q", got, test.want)
			}
			got := ""
			if refusal := chat.refusal(opening, now); refusal != nil {
				got = refusal.Type
			}
			if got != test.refusal {
				t.Fatalf("refusal = %q, want %q", got, test.refusal)
			}
		})
	}
}
