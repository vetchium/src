// Package agencycontacts carries an agency's Contacts between tenants
// (agent-guides/marketplace.md, Agency contacts). The agency's tenant is
// authoritative for the Contact and its notes; the Hub user's tenant keeps one
// pointer per Contact so the messages setting and deletion notices reach the
// agency (MKT-DAT-003), and no Hub API returns it (MKT-CON-006).
package agencycontacts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	directoryspec "github.com/vetchium/src/typespec/directory"
	federationspec "github.com/vetchium/src/typespec/federation"
	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
	"github.com/vetchium/src/typespec/orgs/openings"

	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/federation/events"
)

// SyncPointer reports a Contact's current state to the Hub user's tenant:
// it takes the Contact's next pointer version and reads what the pointer
// carries, so every event supersedes the last whatever changed. Call it in
// the transaction that changes the Contact or its conversation, beside that
// change's audit event. newAgencyMessage marks an agency message, which
// counts as unread there and triggers the notification email (MKT-CNV-008).
func SyncPointer(
	ctx context.Context, q sqlc.Querier, orgDID, contactID pgtype.UUID,
	newAgencyMessage bool,
) error {
	row, err := q.NextOrgContactPointer(ctx, sqlc.NextOrgContactPointerParams{
		ContactID: contactID, OrgDid: orgDID,
	})
	if err != nil {
		return fmt.Errorf("take agency pointer version: %w", err)
	}
	payload := federationspec.AgencyPointerChangedPayload{
		ContactID:        contacts.ContactID(dbvalue.FormatUUID(row.ContactID)),
		AgencyOrgDID:     orgs.OrgDID(dbvalue.FormatUUID(row.OrgDid)),
		HubUserDID:       hub.HubUserDID(dbvalue.FormatUUID(row.HubUserDid)),
		Present:          true,
		NewAgencyMessage: newAgencyMessage,
	}
	if row.ConversationID.Valid {
		suggestions, err := q.ListOrgConversationSuggestions(ctx, row.ConversationID)
		if err != nil {
			return fmt.Errorf("list conversation suggestions: %w", err)
		}
		payload.HasConversation = true
		payload.AgencyDisplayName = row.RecordedAgencyName.String
		payload.AgencyDomain = orgs.OrgDomain(row.RecordedAgencyDomain.String)
		at := row.LastActivityAt.Time.UTC()
		payload.LastActivityAt = &at
		if row.ReadOnlyReason.Valid {
			reason := contacts.ConversationReadOnlyReason(row.ReadOnlyReason.String)
			payload.ReadOnlyReason = &reason
		}
		payload.Suggestions = make([]federationspec.AgencyPointerSuggestion, 0, len(suggestions))
		for _, suggestion := range suggestions {
			payload.Suggestions = append(payload.Suggestions,
				federationspec.AgencyPointerSuggestion{
					ConsumerDomain: orgs.OrgDomain(suggestion.ConsumerDomain),
					OpeningNumber:  openings.OpeningNumber(suggestion.OpeningNumber),
					SentAt:         suggestion.SentAt.Time.UTC(),
				})
		}
	}
	return enqueuePointer(ctx, q, row.HubUserDid, row.PointerVersion, payload)
}

// RemovePointer reports a deleted Contact; version is the pointer version
// the Contact had, which the removal supersedes.
func RemovePointer(
	ctx context.Context, q sqlc.Querier, orgDID, contactID, hubDID pgtype.UUID,
	version int32,
) error {
	return enqueuePointer(ctx, q, hubDID, version+1,
		federationspec.AgencyPointerChangedPayload{
			ContactID:    contacts.ContactID(dbvalue.FormatUUID(contactID)),
			AgencyOrgDID: orgs.OrgDID(dbvalue.FormatUUID(orgDID)),
			HubUserDID:   hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		})
}

func enqueuePointer(
	ctx context.Context, q sqlc.Querier, hubDID pgtype.UUID, version int32,
	payload federationspec.AgencyPointerChangedPayload,
) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind: federationspec.AgencyPointerChangedKind,
		Destination: events.Principal{
			Type: directoryspec.PrincipalHubUser, DID: hubDID,
		},
		AggregateType:    federationspec.AgencyPointerAggregate,
		AggregateID:      string(payload.ContactID),
		AggregateVersion: int64(version),
		Payload:          payload,
	})
	if err != nil {
		return fmt.Errorf("enqueue agency pointer: %w", err)
	}
	return nil
}

// RegisterEvents adds the pointer event and the two notices the Hub user's
// tenant sends back.
func RegisterEvents(registry *events.Registry) {
	registry.Register(federationspec.AgencyPointerChangedKind,
		applyPointer, pointerOrigin)
	registry.Register(federationspec.HubAccountDeletedKind,
		applyAccountDeleted, accountDeletedOrigin)
	registry.Register(federationspec.HubAgencyMessagesChangedKind,
		applyMessagesChanged, messagesChangedOrigin)
}

func decodePayload(event events.Event, payload interface{ Validate() []string }) error {
	decoder := json.NewDecoder(bytes.NewReader(event.Payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(payload); err != nil ||
		decoder.Decode(&struct{}{}) != io.EOF {
		return fmt.Errorf("decode %s payload: %v", event.Kind, err)
	}
	if fields := payload.Validate(); len(fields) > 0 {
		return fmt.Errorf("invalid %s payload: %v", event.Kind, fields)
	}
	return nil
}

func principalFor(kind directoryspec.PrincipalType, did string) (events.Principal, bool) {
	parsed, err := dbvalue.ParseUUID(did)
	if err != nil {
		return events.Principal{}, false
	}
	return events.Principal{Type: kind, DID: parsed}, true
}

func payloadField(event events.Event, field string) string {
	var payload map[string]any
	if json.Unmarshal(event.Payload, &payload) != nil {
		return ""
	}
	value, _ := payload[field].(string)
	return value
}

// pointerOrigin is the agency Org, the Contact's authority.
func pointerOrigin(event events.Event) (events.Principal, bool) {
	return principalFor(directoryspec.PrincipalOrg, payloadField(event, "agency_org_did"))
}

// messagesChangedOrigin is the Hub user, whose setting it reports.
func messagesChangedOrigin(event events.Event) (events.Principal, bool) {
	return principalFor(directoryspec.PrincipalHubUser, payloadField(event, "hub_user_did"))
}

// accountDeletedOrigin is the Hub user, whose account the notice reports
// gone. The account row may be gone from its home tenant by the time the
// event arrives, so a notice this tenant sends itself names the agency Org it
// is delivered to, which this tenant homes; a tenant's own outbox is the proof
// that the notice is its own.
func accountDeletedOrigin(event events.Event) (events.Principal, bool) {
	if event.SourceTenantID == event.TenantID {
		return event.Destination, event.Destination.Type == directoryspec.PrincipalOrg
	}
	return principalFor(directoryspec.PrincipalHubUser, payloadField(event, "hub_user_did"))
}

// applyPointer runs at the Hub user's tenant. An account that does not exist
// is answered with the deletion notice (MKT-DAT-013); one that turned agency
// messages off tells the agency at once (MKT-DAT-006).
func applyPointer(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.AgencyPointerChangedPayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return err
	}
	orgDID, err := dbvalue.ParseUUID(string(payload.AgencyOrgDID))
	if err != nil {
		return err
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return err
	}
	if event.Destination.Type != directoryspec.PrincipalHubUser ||
		event.Destination.DID != hubDID ||
		event.AggregateType != federationspec.AgencyPointerAggregate ||
		event.AggregateID != string(payload.ContactID) {
		return fmt.Errorf("agency-pointer-changed envelope does not match its payload")
	}
	q := sqlc.New(tx)
	if !payload.Present {
		if _, err := q.DeleteHubAgencyPointer(ctx, sqlc.DeleteHubAgencyPointerParams{
			ContactID: contactID, HubUserDid: hubDID,
		}); err != nil {
			return fmt.Errorf("delete agency pointer: %w", err)
		}
		return nil
	}
	state, err := q.GetHubUserAgencyState(ctx, hubDID)
	if errors.Is(err, pgx.ErrNoRows) {
		return enqueueAccountDeleted(ctx, q, orgDID, hubDID)
	}
	if err != nil {
		return fmt.Errorf("read agency messages setting: %w", err)
	}

	lastActivity := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	if payload.LastActivityAt != nil {
		lastActivity = pgtype.Timestamptz{Time: *payload.LastActivityAt, Valid: true}
	}
	var readOnly pgtype.Text
	if !state.AgenciesMayMessage {
		readOnly = dbvalue.Text("messages_off")
	} else if payload.ReadOnlyReason != nil {
		readOnly = pgtype.Text{String: string(*payload.ReadOnlyReason), Valid: true}
	}
	suggestions := payload.Suggestions
	if suggestions == nil {
		suggestions = []federationspec.AgencyPointerSuggestion{}
	}
	suggestionsBytes, err := json.Marshal(suggestions)
	if err != nil {
		return fmt.Errorf("encode pointer suggestions: %w", err)
	}
	unreadCount := int32(0)
	if payload.NewAgencyMessage {
		unreadCount = 1
	}

	if _, err := q.UpsertHubAgencyPointer(ctx, sqlc.UpsertHubAgencyPointerParams{
		ContactID:         contactID,
		HubUserDid:        hubDID,
		AgencyOrgDid:      orgDID,
		AgencyDisplayName: payload.AgencyDisplayName,
		AgencyDomain:      string(payload.AgencyDomain),
		HasConversation:   payload.HasConversation,
		LastActivityAt:    lastActivity,
		UnreadCount:       unreadCount,
		ReadOnlyReason:    readOnly,
		Suggestions:       suggestionsBytes,
		PointerVersion:    int32(event.AggregateVersion),
		IncrementUnread:   payload.NewAgencyMessage,
	}); err != nil {
		return fmt.Errorf("upsert agency pointer: %w", err)
	}

	if payload.NewAgencyMessage && payload.AgencyDisplayName != "" {
		if err := q.InsertHubMessageNotice(ctx, sqlc.InsertHubMessageNoticeParams{
			HubUserDid:        hubDID,
			AgencyDisplayName: payload.AgencyDisplayName,
		}); err != nil {
			return fmt.Errorf("insert message notice: %w", err)
		}
	}

	if state.AgenciesMayMessage {
		return nil
	}
	return EnqueueMessagesState(ctx, q, MessagesState{
		ContactID: contactID, OrgDID: orgDID, HubUserDID: hubDID,
		Version: state.AgenciesMayMessageVersion, MessagesOff: true,
	})
}

func enqueueAccountDeleted(
	ctx context.Context, q sqlc.Querier, orgDID, hubDID pgtype.UUID,
) error {
	_, err := events.Enqueue(ctx, q, events.Outgoing{
		Kind:             federationspec.HubAccountDeletedKind,
		Destination:      events.Principal{Type: directoryspec.PrincipalOrg, DID: orgDID},
		AggregateType:    federationspec.HubAccountAggregate,
		AggregateID:      dbvalue.FormatUUID(hubDID),
		AggregateVersion: 1,
		Payload: federationspec.HubAccountDeletedPayload{
			HubUserDID: hub.HubUserDID(dbvalue.FormatUUID(hubDID)),
		},
	})
	if err != nil {
		return fmt.Errorf("enqueue deletion notice: %w", err)
	}
	return nil
}

// MessagesState is the Hub user's "Agencies may message me" as one agency
// Contact keeps it.
type MessagesState struct {
	ContactID, OrgDID, HubUserDID pgtype.UUID
	// Version is the setting's version.
	Version     int64
	MessagesOff bool
}

// EnqueueMessagesState tells the agency of a pointer the state of the
// setting. Call it in the transaction that creates the pointer or changes the
// setting.
func EnqueueMessagesState(ctx context.Context, q sqlc.Querier, s MessagesState) error {
	return EnqueueMessagesStates(ctx, q, []MessagesState{s})
}

// EnqueueMessagesStates is EnqueueMessagesState for several pointers.
func EnqueueMessagesStates(ctx context.Context, q sqlc.Querier, states []MessagesState) error {
	outgoing := make([]events.Outgoing, len(states))
	for index, s := range states {
		outgoing[index] = events.Outgoing{
			Kind:             federationspec.HubAgencyMessagesChangedKind,
			Destination:      events.Principal{Type: directoryspec.PrincipalOrg, DID: s.OrgDID},
			AggregateType:    federationspec.AgencyContactMessagesAggregate,
			AggregateID:      dbvalue.FormatUUID(s.ContactID),
			AggregateVersion: s.Version,
			Payload: federationspec.HubAgencyMessagesChangedPayload{
				ContactID:   contacts.ContactID(dbvalue.FormatUUID(s.ContactID)),
				HubUserDID:  hub.HubUserDID(dbvalue.FormatUUID(s.HubUserDID)),
				MessagesOff: s.MessagesOff,
			},
		}
	}
	if err := events.EnqueueAll(ctx, q, outgoing); err != nil {
		return fmt.Errorf("enqueue agency messages state: %w", err)
	}
	return nil
}

// applyAccountDeleted runs at the agency's tenant: the notes on the person go
// at once; a Contact whose conversation remains stays, its conversation
// read-only with the reason, and every other Contact of the person goes
// (MKT-DAT-012, MKT-CON-004, MKT-CNV-011).
func applyAccountDeleted(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubAccountDeletedPayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return err
	}
	if event.Destination.Type != directoryspec.PrincipalOrg ||
		event.AggregateType != federationspec.HubAccountAggregate ||
		event.AggregateID != string(payload.HubUserDID) {
		return fmt.Errorf("hub-account-deleted envelope does not match its payload")
	}
	q := sqlc.New(tx)
	if _, err := q.DeleteOrgContactNotesOfPerson(ctx,
		sqlc.DeleteOrgContactNotesOfPersonParams{
			OrgDid: event.Destination.DID, HubUserDid: hubDID,
		}); err != nil {
		return fmt.Errorf("delete notes of a deleted account: %w", err)
	}
	if _, err := q.MarkOrgConversationsHubUserDeleted(ctx,
		sqlc.MarkOrgConversationsHubUserDeletedParams{
			OrgDid: event.Destination.DID, HubUserDid: hubDID,
		}); err != nil {
		return fmt.Errorf("mark conversations of a deleted account: %w", err)
	}
	if _, err := q.DeleteOrgContactsWithoutConversationOfPerson(ctx,
		sqlc.DeleteOrgContactsWithoutConversationOfPersonParams{
			OrgDid: event.Destination.DID, HubUserDid: hubDID,
		}); err != nil {
		return fmt.Errorf("delete contacts of a deleted account: %w", err)
	}
	return nil
}

// applyMessagesChanged runs at the agency's tenant and stores the Hub user's
// setting on the Contact. A Contact that is gone has nothing to store it on.
func applyMessagesChanged(ctx context.Context, tx pgx.Tx, event events.Event) error {
	var payload federationspec.HubAgencyMessagesChangedPayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	hubDID, err := dbvalue.ParseUUID(string(payload.HubUserDID))
	if err != nil {
		return err
	}
	contactID, err := dbvalue.ParseUUID(string(payload.ContactID))
	if err != nil {
		return err
	}
	if event.Destination.Type != directoryspec.PrincipalOrg ||
		event.AggregateType != federationspec.AgencyContactMessagesAggregate ||
		event.AggregateID != string(payload.ContactID) {
		return fmt.Errorf("hub-agency-messages-changed envelope does not match its payload")
	}
	if _, err := sqlc.New(tx).SetOrgContactMessagesOff(ctx,
		sqlc.SetOrgContactMessagesOffParams{
			ContactID: contactID, OrgDid: event.Destination.DID,
			HubUserDid: hubDID, MessagesOff: payload.MessagesOff,
		}); err != nil {
		return fmt.Errorf("store agency messages state: %w", err)
	}
	return nil
}
