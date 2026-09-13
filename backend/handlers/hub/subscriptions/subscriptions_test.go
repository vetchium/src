// Test coverage split: this file covers every branch of setPlan and
// MySubscription reachable with a query stub, plus the handler-level cases
// that only involve decoding, validation, and middleware (400s before the
// transaction, and 401 from authentication). The idempotency-key-conflict
// 409, and replay, need the ledger transaction and are covered in
// Playwright (playwright/api/hub-subscriptions.spec.ts).
package subscriptions

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
	hubruntime "backend/internal/hub"
	hubauthn "backend/internal/hub/auth"
	"backend/internal/hub/billing"
	"backend/internal/middleware"
)

func testUUID(last byte) pgtype.UUID {
	value := [16]byte{6: 0x70, 8: 0x80, 15: last}
	return pgtype.UUID{Bytes: value, Valid: true}
}

func testTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func testInterval(value subscriptionspec.BillingInterval) sqlc.NullVetchiumHubBillingInterval {
	return sqlc.NullVetchiumHubBillingInterval{
		VetchiumHubBillingInterval: sqlc.VetchiumHubBillingInterval(value),
		Valid:                      true,
	}
}

func TestStoredFromMySubscriptionFreePlan(t *testing.T) {
	row := sqlc.GetHubMySubscriptionRow{HubPlanOid: "hub-free-tier"}
	stored := storedFromMySubscription(row)
	if stored.PlanOID != "hub-free-tier" || stored.Interval != "" ||
		stored.AnchorAt != nil || stored.PeriodStart != nil ||
		stored.PeriodEnd != nil || stored.ScheduledPlanOID != "" {
		t.Fatalf("stored = %+v", stored)
	}
}

func TestStoredFromMySubscriptionPaidPlanWithSchedule(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	row := sqlc.GetHubMySubscriptionRow{
		HubPlanOid:                  "hub-silver-tier",
		SubscriptionBillingInterval: testInterval(subscriptionspec.Month),
		SubscriptionAnchorAt:        testTimestamptz(anchor),
		SubscriptionPeriodStart:     testTimestamptz(anchor),
		SubscriptionPeriodEnd:       testTimestamptz(end),
		ScheduledHubPlanOid:         pgtype.Text{String: "hub-free-tier", Valid: true},
	}
	stored := storedFromMySubscription(row)
	if stored.PlanOID != "hub-silver-tier" ||
		stored.Interval != string(subscriptionspec.Month) ||
		stored.AnchorAt == nil || !stored.AnchorAt.Equal(anchor) ||
		stored.PeriodEnd == nil || !stored.PeriodEnd.Equal(end) ||
		stored.ScheduledPlanOID != "hub-free-tier" ||
		stored.ScheduledInterval != "" {
		t.Fatalf("stored = %+v", stored)
	}
}

func TestStoredFromLockAdapter(t *testing.T) {
	row := sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-free-tier"}
	stored := storedFromLock(row)
	if stored.PlanOID != "hub-free-tier" || stored.AnchorAt != nil {
		t.Fatalf("stored = %+v", stored)
	}
}

type setPlanStub struct {
	lockCalled bool
	lockRow    sqlc.LockHubSubscriptionForChangeRow
	lockErr    error

	saveParams sqlc.SaveHubSubscriptionStatesParams
	saveResult sqlc.SaveHubSubscriptionStatesRow
	saveErr    error
}

func (s *setPlanStub) LockHubSubscriptionForChange(
	context.Context, pgtype.UUID,
) (sqlc.LockHubSubscriptionForChangeRow, error) {
	s.lockCalled = true
	return s.lockRow, s.lockErr
}

func (s *setPlanStub) SaveHubSubscriptionStates(
	_ context.Context, params sqlc.SaveHubSubscriptionStatesParams,
) (sqlc.SaveHubSubscriptionStatesRow, error) {
	s.saveParams = params
	return s.saveResult, s.saveErr
}

var testNow = time.Date(2027, time.January, 10, 12, 0, 0, 123456789, time.UTC)

func testEnv(offered ...subscriptionspec.Plan) setPlanEnv {
	return setPlanEnv{
		TenantID: "sgp",
		Offers: func(plan subscriptionspec.Plan) bool {
			for _, o := range offered {
				if o == plan {
					return true
				}
			}
			return false
		},
		Now: func() time.Time { return testNow },
	}
}

func freeRequest() subscriptionspec.SetSubscriptionPlanRequest {
	return subscriptionspec.SetSubscriptionPlanRequest{
		PlanOID: subscriptionspec.FreeTier,
	}
}

func silverRequest(
	interval subscriptionspec.BillingInterval,
) subscriptionspec.SetSubscriptionPlanRequest {
	return subscriptionspec.SetSubscriptionPlanRequest{
		PlanOID: subscriptionspec.SilverTier,
		BillingInterval: subscriptionspec.OptionalBillingInterval{
			Present: true, Value: interval,
		},
	}
}

func TestSetPlanNotOffered(t *testing.T) {
	stub := &setPlanStub{}
	_, apiProblem, err := setPlan(
		context.Background(), testEnv(subscriptionspec.FreeTier), stub,
		testUUID(1), silverRequest(subscriptionspec.Month), "key-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if apiProblem == nil ||
		apiProblem.Details.ProblemDetails().Type != hubproblem.PlanNotOfferedError.Type {
		t.Fatalf("problem = %+v", apiProblem)
	}
	if stub.lockCalled {
		t.Fatal("the lock must not be taken for an unoffered plan")
	}
}

func TestSetPlanAuthenticationFailureFromLock(t *testing.T) {
	stub := &setPlanStub{lockErr: pgx.ErrNoRows}
	_, apiProblem, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), freeRequest(), "key-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if apiProblem == nil ||
		apiProblem.Details.ProblemDetails().Type != hubproblem.AuthenticationRequiredError.Type ||
		apiProblem.WWWAuthenticate != hubauthn.BearerChallenge {
		t.Fatalf("problem = %+v", apiProblem)
	}
}

func TestSetPlanLockErrorPropagates(t *testing.T) {
	stub := &setPlanStub{lockErr: errors.New("connection reset")}
	_, _, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), freeRequest(), "key-1",
	)
	if err == nil {
		t.Fatal("expected the lock error to propagate")
	}
}

func TestSetPlanUnknownPlanInRowIs500(t *testing.T) {
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-gold-tier"},
	}
	_, apiProblem, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), freeRequest(), "key-1",
	)
	if err == nil || apiProblem != nil {
		t.Fatalf("expected an internal error, got problem=%+v err=%v", apiProblem, err)
	}
}

func TestSetPlanUpgradeWritesStatesAndEvents(t *testing.T) {
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-free-tier"},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	result, apiProblem, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), silverRequest(subscriptionspec.Month), "key-1",
	)
	if err != nil || apiProblem != nil {
		t.Fatalf("err=%v problem=%+v", err, apiProblem)
	}
	if result.Status != http.StatusOK {
		t.Fatalf("status = %d", result.Status)
	}
	if result.Body.PlanOID != subscriptionspec.PlanOID(subscriptionspec.SilverTier) {
		t.Fatalf("body = %+v", result.Body)
	}
	if result.Body.CurrentPeriodStart == nil ||
		!result.Body.CurrentPeriodStart.Equal(billing.Instant(testNow)) {
		t.Fatalf("period start = %v, want %v", result.Body.CurrentPeriodStart, testNow)
	}

	var states []billing.StateRecord
	if err := json.Unmarshal(stub.saveParams.States, &states); err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].HubPlanOID != "hub-silver-tier" {
		t.Fatalf("states = %+v", states)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(stub.saveParams.Events, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != billing.ActionUpgraded ||
		events[0].ActorType != "hub_user" {
		t.Fatalf("events = %+v", events)
	}
	if stub.saveParams.IdempotencyKey.String != "key-1" ||
		!stub.saveParams.IdempotencyKey.Valid {
		t.Fatalf("idempotency key = %+v", stub.saveParams.IdempotencyKey)
	}
	if stub.saveParams.Source != "hub-api" {
		t.Fatalf("source = %q", stub.saveParams.Source)
	}
}

func TestSetPlanUnchangedWithNoTransitionsWritesNothing(t *testing.T) {
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-free-tier"},
	}
	result, apiProblem, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), freeRequest(), "key-1",
	)
	if err != nil || apiProblem != nil {
		t.Fatalf("err=%v problem=%+v", err, apiProblem)
	}
	if result.Body.PlanOID != subscriptionspec.PlanOID(subscriptionspec.FreeTier) {
		t.Fatalf("body = %+v", result.Body)
	}
	if stub.saveParams.States != nil {
		t.Fatal("Unchanged with no due transition must write nothing")
	}
}

func TestSetPlanScheduledChangeClearedWritesOnlyDecisionEvent(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{
			HubPlanOid:                  "hub-silver-tier",
			SubscriptionBillingInterval: testInterval(subscriptionspec.Month),
			SubscriptionAnchorAt:        testTimestamptz(anchor),
			SubscriptionPeriodStart:     testTimestamptz(anchor),
			SubscriptionPeriodEnd:       testTimestamptz(end),
			ScheduledHubPlanOid:         pgtype.Text{String: "hub-free-tier", Valid: true},
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	env := testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier)
	env.Now = func() time.Time { return anchor.Add(10 * 24 * time.Hour) }
	result, apiProblem, err := setPlan(
		context.Background(), env, stub, testUUID(1),
		silverRequest(subscriptionspec.Month), "key-2",
	)
	if err != nil || apiProblem != nil {
		t.Fatalf("err=%v problem=%+v", err, apiProblem)
	}
	if result.Body.CancelAtPeriodEnd {
		t.Fatalf("schedule was not cleared: %+v", result.Body)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(stub.saveParams.Events, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != billing.ActionScheduledChangeCleared {
		t.Fatalf("events = %+v", events)
	}
}

func TestSetPlanDueTransitionAloneWritesOnlySystemEvent(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{
			HubPlanOid:                  "hub-silver-tier",
			SubscriptionBillingInterval: testInterval(subscriptionspec.Month),
			SubscriptionAnchorAt:        testTimestamptz(anchor),
			SubscriptionPeriodStart:     testTimestamptz(anchor),
			SubscriptionPeriodEnd:       testTimestamptz(end),
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 1,
		},
	}
	env := testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier)
	// The period is already due, and choosing the current (renewed) plan and
	// interval decides Unchanged: only the worker-style renewal event is
	// written, with no hub_user event.
	env.Now = func() time.Time { return end }
	result, apiProblem, err := setPlan(
		context.Background(), env, stub, testUUID(1),
		silverRequest(subscriptionspec.Month), "key-3",
	)
	if err != nil || apiProblem != nil {
		t.Fatalf("err=%v problem=%+v", err, apiProblem)
	}
	if !result.Body.CurrentPeriodStart.Equal(end) {
		t.Fatalf("body = %+v", result.Body)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(stub.saveParams.Events, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != billing.ActionRenewed ||
		events[0].ActorType != "system" {
		t.Fatalf("events = %+v, want exactly one system-actor renewal", events)
	}
}

func TestSetPlanDueTransitionFollowedByChangeWritesBothEventKinds(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{
			HubPlanOid:                  "hub-silver-tier",
			SubscriptionBillingInterval: testInterval(subscriptionspec.Month),
			SubscriptionAnchorAt:        testTimestamptz(anchor),
			SubscriptionPeriodStart:     testTimestamptz(anchor),
			SubscriptionPeriodEnd:       testTimestamptz(end),
		},
		saveResult: sqlc.SaveHubSubscriptionStatesRow{
			UpdatedCount: 1, AuditedCount: 2, AuditedUserCount: 1,
		},
	}
	env := testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier)
	env.Now = func() time.Time { return end }
	result, apiProblem, err := setPlan(
		context.Background(), env, stub, testUUID(1), freeRequest(), "key-4",
	)
	if err != nil || apiProblem != nil {
		t.Fatalf("err=%v problem=%+v", err, apiProblem)
	}
	if !result.Body.CancelAtPeriodEnd {
		t.Fatalf("body = %+v, want a scheduled cancellation", result.Body)
	}
	var events []billing.EventRecord
	if err := json.Unmarshal(stub.saveParams.Events, &events); err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Action != billing.ActionRenewed ||
		events[0].ActorType != "system" ||
		events[1].Action != billing.ActionChangeScheduled ||
		events[1].ActorType != "hub_user" {
		t.Fatalf("events = %+v", events)
	}
}

func TestSetPlanSaveErrorPropagates(t *testing.T) {
	stub := &setPlanStub{
		lockRow: sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-free-tier"},
		saveErr: errors.New("database unavailable"),
	}
	_, _, err := setPlan(
		context.Background(),
		testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
		stub, testUUID(1), silverRequest(subscriptionspec.Month), "key-5",
	)
	if err == nil {
		t.Fatal("expected the save error to propagate")
	}
}

func TestSetPlanCountMismatchesAreErrors(t *testing.T) {
	for name, result := range map[string]sqlc.SaveHubSubscriptionStatesRow{
		"zero updated":          {UpdatedCount: 0, AuditedCount: 1, AuditedUserCount: 0},
		"short audited":         {UpdatedCount: 1, AuditedCount: 0, AuditedUserCount: 1},
		"audited user mismatch": {UpdatedCount: 1, AuditedCount: 1, AuditedUserCount: 0},
	} {
		t.Run(name, func(t *testing.T) {
			stub := &setPlanStub{
				lockRow:    sqlc.LockHubSubscriptionForChangeRow{HubPlanOid: "hub-free-tier"},
				saveResult: result,
			}
			_, _, err := setPlan(
				context.Background(),
				testEnv(subscriptionspec.FreeTier, subscriptionspec.SilverTier),
				stub, testUUID(1), silverRequest(subscriptionspec.Month), "key-6",
			)
			if err == nil {
				t.Fatal("expected a count-mismatch error")
			}
		})
	}
}

func testServer(db sqlc.Querier) *hubruntime.Server {
	return &hubruntime.Server{
		Runtime: apiserver.New(
			nil, slog.New(slog.NewTextHandler(io.Discard, nil)),
		),
		Queries:  db,
		TenantID: "sgp",
		OfferedPlans: []subscriptionspec.Plan{
			subscriptionspec.FreeTier, subscriptionspec.SilverTier,
		},
		CredentialKey: hubauthn.DeriveCredentialKey("sgp", "secret-key-value"),
		Now:           func() time.Time { return testNow },
	}
}

type authenticatingStub struct {
	sqlc.Querier
}

func (authenticatingStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid: testUUID(1), HubSessionID: testUUID(2),
		AuthenticatedAt: testTimestamptz(testNow),
	}, nil
}

func postJSON(handler http.Handler, body string, withToken bool) *httptest.ResponseRecorder {
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/set-subscription-plan",
		bytes.NewBufferString(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "a-valid-idempotency-key-1234567890")
	if withToken {
		request.Header.Set("Authorization", "Bearer session-token")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestSetSubscriptionPlanRejectsInvalidJSON(t *testing.T) {
	server := testServer(authenticatingStub{})
	handler := middleware.HubAuth(server)(SetSubscriptionPlan(server))
	for _, body := range []string{
		`{`,
		`{"plan_oid":"hub-silver-tier","billing_interval":1}`,
	} {
		response := postJSON(handler, body, true)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, body = %s", response.Code, response.Body)
		}
		if got := response.Header().Get("Content-Type"); got != problem.MediaType {
			t.Fatalf("Content-Type = %q, want %q", got, problem.MediaType)
		}
		var details problem.Details
		if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
			t.Fatal(err)
		}
		if details.Type != problem.InvalidJSONError.Type {
			t.Fatalf("problem = %+v", details)
		}
	}
}

func TestSetSubscriptionPlanRejectsValidationFailures(t *testing.T) {
	server := testServer(authenticatingStub{})
	handler := middleware.HubAuth(server)(SetSubscriptionPlan(server))
	tests := []struct {
		body   string
		fields []string
	}{
		{`{"plan_oid":"hub-gold-tier"}`, []string{"plan_oid"}},
		{
			`{"plan_oid":"hub-free-tier","billing_interval":"month"}`,
			[]string{"billing_interval"},
		},
		{
			`{"plan_oid":"hub-free-tier","billing_interval":null}`,
			[]string{"billing_interval"},
		},
		{`{"plan_oid":"hub-silver-tier"}`, []string{"billing_interval"}},
		{
			`{"plan_oid":"hub-silver-tier","billing_interval":null}`,
			[]string{"billing_interval"},
		},
		{
			`{"plan_oid":"hub-silver-tier","billing_interval":"week"}`,
			[]string{"billing_interval"},
		},
	}
	for _, tt := range tests {
		response := postJSON(handler, tt.body, true)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status = %d, resp = %s", tt.body, response.Code, response.Body)
		}
		var details problem.Details
		if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
			t.Fatal(err)
		}
		if details.Type != problem.ValidationFailedError.Type ||
			!slices.Equal(details.Fields, tt.fields) {
			t.Fatalf("body=%s problem = %+v, want fields %v", tt.body, details, tt.fields)
		}
	}
}

func TestSetSubscriptionPlanRejectsMalformedIdempotencyKey(t *testing.T) {
	server := testServer(authenticatingStub{})
	handler := middleware.HubAuth(server)(SetSubscriptionPlan(server))
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/set-subscription-plan",
		bytes.NewBufferString(`{"plan_oid":"hub-free-tier"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	request.Header.Set("Idempotency-Key", "too-short")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	var details problem.Details
	if err := json.NewDecoder(response.Body).Decode(&details); err != nil {
		t.Fatal(err)
	}
	if details.Type != problem.ValidationFailedError.Type ||
		!slices.Equal(details.Fields, []string{"Idempotency-Key"}) {
		t.Fatalf("problem = %+v", details)
	}
}

func TestSetSubscriptionPlanRequiresIdempotencyKey(t *testing.T) {
	server := testServer(authenticatingStub{})
	handler := middleware.HubAuth(server)(SetSubscriptionPlan(server))
	request := httptest.NewRequest(
		http.MethodPost, "/api/hub/set-subscription-plan",
		bytes.NewBufferString(`{"plan_oid":"hub-free-tier"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
}

func TestSetSubscriptionPlanRejectsMissingAndDisabledSessions(t *testing.T) {
	server := testServer(sqlc.Querier(rejectingStub{}))
	handler := middleware.HubAuth(server)(SetSubscriptionPlan(server))

	response := postJSON(handler, `{"plan_oid":"hub-free-tier"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("no token: status = %d", response.Code)
	}
	if got := response.Header().Get("WWW-Authenticate"); got != hubauthn.BearerChallenge {
		t.Fatalf("no token: WWW-Authenticate = %q", got)
	}

	response = postJSON(handler, `{"plan_oid":"hub-free-tier"}`, true)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("disabled user: status = %d", response.Code)
	}
	if got := response.Header().Get("WWW-Authenticate"); got != hubauthn.BearerChallenge {
		t.Fatalf("disabled user: WWW-Authenticate = %q", got)
	}
}

type rejectingStub struct {
	sqlc.Querier
}

func (rejectingStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{}, pgx.ErrNoRows
}

func TestMySubscriptionReturnsAdvancedStateWithoutWriting(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	db := &mySubscriptionStub{
		row: sqlc.GetHubMySubscriptionRow{
			HubPlanOid:                  "hub-silver-tier",
			SubscriptionBillingInterval: testInterval(subscriptionspec.Month),
			SubscriptionAnchorAt:        testTimestamptz(anchor),
			SubscriptionPeriodStart:     testTimestamptz(anchor),
			SubscriptionPeriodEnd:       testTimestamptz(end),
		},
	}
	server := testServer(db)
	server.Now = func() time.Time { return end.Add(24 * time.Hour) }
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	var body subscriptionspec.HubSubscription
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	// One period advanced past the stored end; GET must show the advanced
	// state and must not have called any write query (the stub has none).
	wantStart := time.Date(2027, time.February, 1, 0, 0, 0, 0, time.UTC)
	if body.CurrentPeriodStart == nil || !body.CurrentPeriodStart.Equal(wantStart) {
		t.Fatalf("body = %+v", body)
	}
}

func TestMySubscriptionFreePlan(t *testing.T) {
	db := &mySubscriptionStub{
		row: sqlc.GetHubMySubscriptionRow{HubPlanOid: "hub-free-tier"},
	}
	server := testServer(db)
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	var body subscriptionspec.HubSubscription
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	want := subscriptionspec.HubSubscription{
		PlanOID: subscriptionspec.PlanOID(subscriptionspec.FreeTier),
	}
	if body != want {
		t.Fatalf("body = %+v, want %+v", body, want)
	}
}

func TestMySubscriptionWithScheduledChange(t *testing.T) {
	anchor := time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2028, time.January, 1, 0, 0, 0, 0, time.UTC)
	db := &mySubscriptionStub{
		row: sqlc.GetHubMySubscriptionRow{
			HubPlanOid:                  "hub-silver-tier",
			SubscriptionBillingInterval: testInterval(subscriptionspec.Year),
			SubscriptionAnchorAt:        testTimestamptz(anchor),
			SubscriptionPeriodStart:     testTimestamptz(anchor),
			SubscriptionPeriodEnd:       testTimestamptz(end),
			ScheduledHubPlanOid:         pgtype.Text{String: "hub-silver-tier", Valid: true},
			ScheduledBillingInterval:    testInterval(subscriptionspec.Month),
		},
	}
	server := testServer(db)
	server.Now = func() time.Time { return anchor.Add(24 * time.Hour) }
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	var body subscriptionspec.HubSubscription
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.ScheduledChange == nil ||
		body.ScheduledChange.PlanOID != subscriptionspec.PlanOID(subscriptionspec.SilverTier) ||
		body.ScheduledChange.BillingInterval == nil ||
		*body.ScheduledChange.BillingInterval != subscriptionspec.Month {
		t.Fatalf("scheduled_change = %+v", body.ScheduledChange)
	}
}

func TestMySubscriptionUnauthenticatedFromQuery(t *testing.T) {
	db := &mySubscriptionStub{err: pgx.ErrNoRows}
	server := testServer(db)
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", response.Code)
	}
	if got := response.Header().Get("WWW-Authenticate"); got != hubauthn.BearerChallenge {
		t.Fatalf("WWW-Authenticate = %q", got)
	}
}

func TestMySubscriptionDatabaseErrorIs500(t *testing.T) {
	db := &mySubscriptionStub{err: errors.New("database unavailable")}
	server := testServer(db)
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestMySubscriptionUnknownPlanIs500(t *testing.T) {
	db := &mySubscriptionStub{
		row: sqlc.GetHubMySubscriptionRow{HubPlanOid: "hub-gold-tier"},
	}
	server := testServer(db)
	handler := middleware.HubAuth(server)(MySubscription(server))
	request := httptest.NewRequest(http.MethodGet, "/api/hub/my-subscription", nil)
	request.Header.Set("Authorization", "Bearer session-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
}

type mySubscriptionStub struct {
	sqlc.Querier
	row sqlc.GetHubMySubscriptionRow
	err error
}

func (s *mySubscriptionStub) AuthenticateHubSession(
	context.Context, []byte,
) (sqlc.AuthenticateHubSessionRow, error) {
	return sqlc.AuthenticateHubSessionRow{
		HubUserDid: testUUID(1), HubSessionID: testUUID(2),
		AuthenticatedAt: testTimestamptz(testNow),
	}, nil
}

func (s *mySubscriptionStub) GetHubMySubscription(
	context.Context, sqlc.GetHubMySubscriptionParams,
) (sqlc.GetHubMySubscriptionRow, error) {
	return s.row, s.err
}
