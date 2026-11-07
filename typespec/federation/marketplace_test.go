package federation

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
)

const (
	consumerDID = "01900000-0000-7000-8000-000000000001"
	providerDID = "01900000-0000-7000-8000-000000000002"
)

func snapshot() EngagementSnapshot {
	proposed := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	return EngagementSnapshot{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 1,
		Consumer:   EngagementSnapshotOrg{OrgDID: consumerDID, Domain: "client.test", DisplayName: "Client"},
		Provider:   EngagementSnapshotOrg{OrgDID: providerDID, Domain: "agency.test", DisplayName: "Agency"},
		Capability: marketplace.Sourcing, State: marketplace.ProposedEngagement,
		ProposedAt: proposed, ExpiresAt: proposed.Add(marketplace.ProposalLifetime),
		UpdatedAt: proposed,
	}
}

func TestEngagementKinds(t *testing.T) {
	t.Parallel()
	for _, kind := range []CommandKind{
		EngagementAcceptKind, EngagementDeclineKind, EngagementEndKind, EngagementSetReferenceKind,
	} {
		if !IsCommandKind(kind) {
			t.Errorf("%q is not a command kind", kind)
		}
	}
	if !IsEventKind(EngagementChangedKind) || !IsAggregateType(EngagementAggregate) {
		t.Fatal("engagement event kind or aggregate is invalid")
	}
}

func TestEngagementSnapshotValidation(t *testing.T) {
	t.Parallel()
	if got := snapshot().Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	bad := snapshot()
	bad.Version = 0
	bad.Provider.OrgDID = bad.Consumer.OrgDID
	bad.Provider.Domain = "x"
	bad.State = "paused"
	bad.ExpiresAt = bad.ProposedAt
	want := []string{"version", "provider.domain", "provider.org_did", "state", "expires_at"}
	got := bad.Validate()
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
}

func TestEngagementViewSwapsTheCounterparty(t *testing.T) {
	t.Parallel()
	value := snapshot()
	reference := "PO-1"
	value.ConsumerReference = &reference
	decided := value.ProposedAt.Add(time.Hour)
	value.DecidedAt = &decided
	consumer := value.ViewFor(marketplace.ConsumerParty)
	provider := value.ViewFor(marketplace.ProviderParty)
	if consumer.Counterparty.Domain != "agency.test" || provider.Counterparty.Domain != "client.test" {
		t.Fatalf("counterparties = %+v / %+v", consumer.Counterparty, provider.Counterparty)
	}
	for _, view := range []marketplace.Engagement{consumer, provider} {
		if *view.ConsumerReference != "PO-1" || view.ProviderReference != nil ||
			view.DecidedAt == nil || !view.DecidedAt.Equal(decided) {
			t.Fatalf("view = %+v", view)
		}
	}
}

func TestEngagementPayloadValidation(t *testing.T) {
	t.Parallel()
	actor := EngagementActorPayload{
		EngagementID: "01900000-0000-7000-8000-000000000003", Version: 2,
		ProviderOrgDID: providerDID, ProviderDisplayName: "  Agency ", ActorDisplayName: " Ada ",
	}
	copied := actor
	copied.Normalize()
	if copied.ProviderDisplayName != "Agency" || copied.ActorDisplayName != "Ada" || actor.ActorDisplayName != " Ada " {
		t.Fatalf("normalized = %+v", copied)
	}
	if got := copied.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	bad := EngagementActorPayload{ProviderOrgDID: "x"}
	want := []string{"engagement_id", "version", "provider_org_did", "provider_display_name", "actor_display_name"}
	if got := bad.Validate(); !slices.Equal(got, want) {
		t.Fatalf("fields = %v, want %v", got, want)
	}
	long := make([]rune, 2001)
	for i := range long {
		long[i] = 'a'
	}
	note, reference := string(long), string(long[:201])
	end := EngagementEndPayload{EngagementActorPayload: copied, Note: &note}
	if got := end.Validate(); !slices.Equal(got, []string{"note"}) {
		t.Fatalf("end fields = %v", got)
	}
	ref := EngagementReferencePayload{EngagementActorPayload: copied, Reference: &reference}
	if got := ref.Validate(); !slices.Equal(got, []string{"reference"}) {
		t.Fatalf("reference fields = %v", got)
	}
	ref.Reference = nil
	if got := ref.Validate(); len(got) != 0 {
		t.Fatalf("clearing a reference must be valid: %v", got)
	}
}

func TestWorkCommandKinds(t *testing.T) {
	t.Parallel()
	kinds := []CommandKind{
		WorkScheduleInterviewKind, WorkChangeInterviewKind, WorkCancelInterviewKind,
		WorkInterviewOutcomeKind, WorkInterviewFeedbackKind, WorkAssessmentKind,
		WorkBackgroundCheckResultKind,
	}
	seen := map[CommandKind]bool{}
	for _, kind := range kinds {
		if seen[kind] || !strings.HasPrefix(string(kind), "work-") {
			t.Fatalf("%q is duplicated or not a work kind", kind)
		}
		seen[kind] = true
	}
}

func TestWorkPayloadValidation(t *testing.T) {
	t.Parallel()
	actor := WorkActor{
		EngagementID:   "01900000-0000-7000-8000-000000000001",
		WorkID:         "01900000-0000-7000-8000-0000000000aa",
		ProviderOrgDID: "01900000-0000-7000-8000-000000000002",
		ActorEmail:     " Ada@Acme.Test ",
	}
	actor.Normalize()
	if actor.ActorEmail != "ada@acme.test" {
		t.Fatalf("actor email = %q", actor.ActorEmail)
	}
	if got := actor.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	if got := (WorkActor{}).Validate(); !slices.Equal(got,
		[]string{"engagement_id", "work_id", "provider_org_did", "actor_email"}) {
		t.Fatalf("fields = %v", got)
	}
	outcome := WorkInterviewOutcomePayload{WorkActor: actor, InterviewNumber: 1, Outcome: "late"}
	if got := outcome.Validate(); !slices.Equal(got, []string{"outcome"}) {
		t.Fatalf("fields = %v", got)
	}
	outcome.Outcome = "completed"
	if got := outcome.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
	reference := WorkInterviewReferencePayload{WorkActor: actor, InterviewNumber: 0}
	if got := reference.Validate(); !slices.Equal(got, []string{"interview_number"}) {
		t.Fatalf("fields = %v", got)
	}
	check := WorkBackgroundCheckResultPayload{WorkActor: actor, CheckType: "x", Outcome: "clear"}
	if got := check.Validate(); !slices.Equal(got, []string{"check_type"}) {
		t.Fatalf("fields = %v", got)
	}
	assessment := WorkAssessmentPayload{WorkActor: actor, Outcome: "pass"}
	if got := assessment.Validate(); len(got) != 0 {
		t.Fatalf("fields = %v", got)
	}
}

func TestAgencyEventPayloadsValidate(t *testing.T) {
	t.Parallel()
	const (
		contactID = contacts.ContactID("01900000-0000-7000-8000-000000000001")
		orgDID    = orgs.OrgDID("01900000-0000-7000-8000-000000000003")
		hubDID    = hub.HubUserDID("01900000-0000-7000-8000-000000000004")
	)
	if got := (AgencyPointerChangedPayload{ContactID: contactID, AgencyOrgDID: orgDID, HubUserDID: hubDID, Present: true}).Validate(); len(got) != 0 {
		t.Fatalf("valid pointer payload rejected: %v", got)
	}
	want := []string{"contact_id", "agency_org_did", "hub_user_did"}
	if got := (AgencyPointerChangedPayload{}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("pointer fields = %v, want %v", got, want)
	}
	if got := (HubAccountDeletedPayload{HubUserDID: hubDID}).Validate(); len(got) != 0 {
		t.Fatalf("valid notice rejected: %v", got)
	}
	if got := (HubAccountDeletedPayload{}).Validate(); !slices.Equal(got, []string{"hub_user_did"}) {
		t.Fatalf("notice fields = %v", got)
	}
	if got := (HubAgencyMessagesChangedPayload{ContactID: contactID, HubUserDID: hubDID, MessagesOff: true}).Validate(); len(got) != 0 {
		t.Fatalf("valid messages payload rejected: %v", got)
	}
	if got := (HubAgencyMessagesChangedPayload{}).Validate(); !slices.Equal(got, []string{"contact_id", "hub_user_did"}) {
		t.Fatalf("messages fields = %v", got)
	}
}

func TestHubConversationCommandsAndReads(t *testing.T) {
	t.Parallel()
	const (
		contactID = contacts.ContactID("01900000-0000-7000-8000-000000000001")
		orgDID    = orgs.OrgDID("01900000-0000-7000-8000-000000000003")
		hubDID    = hub.HubUserDID("01900000-0000-7000-8000-000000000004")
	)
	reply := HubConversationReplyPayload{
		ContactID: contactID, HubUserDID: hubDID,
		HubUserDisplayName: "Ada Lovelace", HubUserHandle: "abcd1234-0123456789a",
		Text: "Interested", WindowSeconds: 1,
	}
	if got := reply.Validate(); len(got) != 0 {
		t.Fatalf("valid reply rejected: %v", got)
	}
	want := []string{"contact_id", "hub_user_did", "hub_user_display_name", "hub_user_handle", "text", "window_seconds"}
	if got := (HubConversationReplyPayload{Text: " "}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("reply fields = %v, want %v", got, want)
	}
	if got := (HubConversationDeletePayload{ContactID: contactID, HubUserDID: hubDID}).Validate(); len(got) != 0 {
		t.Fatalf("valid delete rejected: %v", got)
	}
	if got := (HubConversationDeletePayload{}).Validate(); !slices.Equal(got, []string{"contact_id", "hub_user_did"}) {
		t.Fatalf("delete fields = %v", got)
	}

	limit, badLimit := int32(contacts.MaxPage), int32(contacts.MaxPage+1)
	read := MeshReadConversationRequest{ContactID: contactID, HubUserDID: hubDID, AgencyOrgDID: orgDID, Limit: &limit}
	if got := read.Validate(); len(got) != 0 {
		t.Fatalf("valid read rejected: %v", got)
	}
	key := common.PaginationKey("")
	got := MeshReadConversationRequest{PaginationKey: &key, Limit: &badLimit}.Validate()
	want = []string{"pagination_key", "limit", "contact_id", "hub_user_did", "agency_org_did"}
	if !slices.Equal(got, want) {
		t.Fatalf("read fields = %v, want %v", got, want)
	}
	if (MeshReadConversationRequest{}).EffectiveLimit() != contacts.DefaultPage {
		t.Fatal("a read without a limit takes the default page")
	}
}

func TestHubChatRequestCommands(t *testing.T) {
	t.Parallel()
	const (
		requestID = contacts.ChatRequestID("01900000-0000-7000-8000-000000000005")
		contactID = contacts.ContactID("01900000-0000-7000-8000-000000000001")
		orgDID    = orgs.OrgDID("01900000-0000-7000-8000-000000000003")
		hubDID    = hub.HubUserDID("01900000-0000-7000-8000-000000000004")
	)
	for _, kind := range []CommandKind{HubChatRequestKind, HubChatRequestAnswerKind} {
		if !IsCommandKind(kind) {
			t.Fatalf("%q is not a command kind", kind)
		}
	}
	note := contacts.ChatRequestNote("About this role")
	padded := contacts.ChatRequestNote(" About this role ")
	request := HubChatRequestPayload{
		RequestID: requestID, AgencyOrgDID: orgDID, HubUserDID: hubDID,
		HubUserDisplayName: "Ada Lovelace", HubUserHandle: "abcd1234-0123456789a",
		ConsumerDomain: "client.test", OpeningNumber: 7, Note: &note,
		WindowSeconds: 7776000,
	}
	if got := request.Validate(); len(got) != 0 {
		t.Fatalf("valid request rejected: %v", got)
	}
	unnormalized := request
	unnormalized.Note = &padded
	if got := unnormalized.Validate(); !slices.Equal(got, []string{"note"}) {
		t.Fatalf("an untrimmed note must be refused, fields = %v", got)
	}
	want := []string{"request_id", "agency_org_did", "hub_user_did", "hub_user_display_name",
		"hub_user_handle", "consumer_domain", "opening_number", "window_seconds"}
	if got := (HubChatRequestPayload{}).Validate(); !slices.Equal(got, want) {
		t.Fatalf("request fields = %v, want %v", got, want)
	}

	sent := HubChatRequestResult{ContactID: contactID, Request: AgencyPointerRequest{
		RequestID: requestID, Direction: contacts.ToAgency, State: contacts.ChatRequestPending,
		ConsumerDomain: "client.test", OpeningNumber: 7, SentAt: time.Unix(1, 0),
	}}
	if got := sent.Validate(); len(got) != 0 {
		t.Fatalf("valid result rejected: %v", got)
	}
	toHub := sent
	toHub.Request.Direction = contacts.ToHubUser
	if got := toHub.Validate(); !slices.Equal(got, []string{"request.direction"}) {
		t.Fatalf("a request to the Hub user is not this result, fields = %v", got)
	}

	scope := contacts.DeclineSender
	badScope := contacts.ChatRequestDeclineScope("forever")
	answer := HubChatRequestAnswerPayload{
		RequestID: requestID, ContactID: contactID, HubUserDID: hubDID,
		HubUserDisplayName: "Ada Lovelace", HubUserHandle: "abcd1234-0123456789a",
		Accept: true, WindowSeconds: 1,
	}
	decline := answer
	decline.Accept, decline.Scope = false, &scope
	acceptWithScope := answer
	acceptWithScope.Scope = &scope
	declineWithoutScope := answer
	declineWithoutScope.Accept = false
	declineBadScope := decline
	declineBadScope.Scope = &badScope
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"accept", answer.Validate(), []string{}},
		{"decline", decline.Validate(), []string{}},
		{"accept with a scope", acceptWithScope.Validate(), []string{"scope"}},
		{"decline without a scope", declineWithoutScope.Validate(), []string{"scope"}},
		{"decline with an unknown scope", declineBadScope.Validate(), []string{"scope"}},
		{"empty", (HubChatRequestAnswerPayload{Accept: true}).Validate(), []string{"request_id", "contact_id",
			"hub_user_did", "hub_user_display_name", "hub_user_handle", "window_seconds"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
}

func TestAgencyPointerRequestCarriesNoNoteAndConsistentDecline(t *testing.T) {
	t.Parallel()
	sentAt := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	lifts := sentAt.Add(90 * 24 * time.Hour)
	opening, sender := contacts.DeclineOpening, contacts.DeclineSender
	base := AgencyPointerRequest{
		RequestID: "01900000-0000-7000-8000-000000000005", Direction: contacts.ToHubUser,
		State: contacts.ChatRequestPending, ConsumerDomain: "client.test", OpeningNumber: 3,
		SentAt: sentAt,
	}
	declinedOpening := base
	declinedOpening.State, declinedOpening.DeclineScope = contacts.ChatRequestDeclined, &opening
	declinedSender := declinedOpening
	declinedSender.DeclineScope, declinedSender.BlockedUntil = &sender, &lifts
	senderWithoutDate := declinedSender
	senderWithoutDate.BlockedUntil = nil
	pendingWithScope := base
	pendingWithScope.DeclineScope = &opening
	tests := []struct {
		name string
		got  []string
		want []string
	}{
		{"pending", base.Validate(), []string{}},
		{"declined for the Opening", declinedOpening.Validate(), []string{}},
		{"declined for the sender", declinedSender.Validate(), []string{}},
		{"sender decline without its lift date", senderWithoutDate.Validate(), []string{"request.blocked_until"}},
		{"pending with a scope", pendingWithScope.Validate(), []string{"request.decline_scope"}},
		{"empty", AgencyPointerRequest{}.Validate(), []string{"request.request_id",
			"request.direction", "request.state", "request.opening"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !slices.Equal(test.got, test.want) {
				t.Fatalf("fields = %v, want %v", test.got, test.want)
			}
		})
	}
	payload := AgencyPointerChangedPayload{
		ContactID: "01900000-0000-7000-8000-000000000001", AgencyOrgDID: consumerDID,
		HubUserDID: "01900000-0000-7000-8000-000000000004", Present: true, Request: &senderWithoutDate,
	}
	if got := payload.Validate(); !slices.Equal(got, []string{"request.blocked_until"}) {
		t.Fatalf("the pointer validates its request, fields = %v", got)
	}
}
