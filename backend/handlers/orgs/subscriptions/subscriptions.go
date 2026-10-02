package subscriptions

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/vetchium/src/typespec/common"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/dbvalue"
	"backend/internal/handlerauth"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
	"backend/internal/orgs/billing"
	"backend/internal/orgs/billingdb"
)

const invoicesPaginationPurpose = "orgs-list-invoices-v1"

func MySubscription(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		row, err := s.Queries.GetOrgSubscription(r.Context(), identity.OrgDID)
		if errors.Is(err, pgx.ErrNoRows) {
			s.AuthenticationProblem(
				r.Context(), w, orgsproblem.AuthenticationRequiredError,
				orgsauthn.BearerChallenge,
			)
			return
		}
		if err != nil {
			s.InternalError(r.Context(), w, "get Org subscription", err)
			return
		}
		state, err := billing.StateFromStored(billingdb.StoredFromRow(identity.OrgDID, row))
		if err != nil {
			s.InternalError(r.Context(), w, "decode Org subscription state", err)
			return
		}
		// GET computes any due transition in memory and writes nothing, so a
		// lagging worker never shows an ended period.
		advanced, _ := billing.Advance(
			state, billing.Instant(s.CurrentTime()), s.Billing, s.Charger,
		)
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, responseFromState(
			advanced, row.SeatsInUse, row.GoogleSignInEnabled,
		))
	}
}

// change names what one request writes: the transitions that fell due ahead
// of it, and its own effect, credited to the Org user.
func change(
	s *orgsruntime.Server, orgDID pgtype.UUID, before, advanced, final billing.State,
	system []billing.Transition, decided *billing.Transition,
	actor billing.Actor, paidBy pgtype.UUID, key common.IdempotencyKey,
) billingdb.Change {
	return billingdb.Change{
		OrgDID: orgDID, Before: before, Advanced: advanced, Final: final,
		System: system, Decided: decided, Actor: actor,
		SystemActor: billing.SystemRenewalActor, PaidBy: paidBy, Key: key,
		TenantID: s.TenantID, Source: billing.SourceOrgsAPI,
	}
}

func refusalProblem(decision billing.Decision, seats int64) problem.Body {
	switch decision.Refusal {
	case billing.RefusalPastDue:
		return orgsproblem.BillingPastDueError
	case billing.RefusalSeatLimit:
		return orgsproblem.UserLimitExceedsTargetError(
			int32(decision.TargetLimit), int32(seats),
		)
	case billing.RefusalPaymentMethodRequired:
		return orgsproblem.PaymentMethodRequiredError
	default:
		return orgsproblem.PaymentDeclinedError
	}
}

func SetSubscriptionPlan(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.SetSubscriptionPlanRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		actor := billing.OrgUserActor(dbvalue.FormatUUID(identity.UserID))
		type result = handlerauth.Result[subscriptionspec.OrgSubscription]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:set-subscription-plan",
			dbvalue.FormatUUID(identity.UserID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				// The target must always be offered, even when re-choosing a
				// current plan the tenant has since withdrawn.
				if !s.Offers(request.PlanOID) {
					return handlerauth.Failure[subscriptionspec.OrgSubscription](
						orgsproblem.PlanNotOfferedError,
					)
				}
				locked, err := q.LockOrgSubscriptionForChange(ctx, identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.AuthenticationFailure[subscriptionspec.OrgSubscription](
						orgsproblem.AuthenticationRequiredError,
						orgsauthn.BearerChallenge,
					)
				}
				if err != nil {
					return result{}, nil, err
				}
				if locked.OrgState != sqlc.VetchiumOrgStateActive {
					return handlerauth.Failure[subscriptionspec.OrgSubscription](
						orgsproblem.OrgSuspendedError,
					)
				}
				seats, err := q.GetOrgSeatsInUse(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				state, err := billing.StateFromStored(
					billingdb.StoredFromRow(identity.OrgDID, sqlc.GetOrgSubscriptionRow(locked)),
				)
				if err != nil {
					return result{}, nil, err
				}

				// `at` is read after the row lock is held, and the row stays
				// locked through the save, so one transition cannot be
				// applied twice by a racing request.
				at := billing.Instant(s.CurrentTime())
				advanced, transitions := billing.Advance(state, at, s.Billing, s.Charger)
				decision := billing.Decide(advanced, billing.Request{
					Plan:     request.PlanOID,
					Interval: request.BillingInterval.Value,
					Seats:    int(seats),
				}, at, s.Charger)

				if decision.Outcome == billing.Refused {
					details := refusalProblem(decision, seats)
					if len(transitions) == 0 {
						return handlerauth.Failure[subscriptionspec.OrgSubscription](details)
					}
					// A due transition (a failed renewal, say) happened whether
					// or not the request was allowed, so it commits with the
					// refusal.
					if err := billingdb.Save(ctx, q, change(
						s, identity.OrgDID, state, advanced, advanced,
						transitions, nil, actor, pgtype.UUID{}, key,
					)); err != nil {
						return result{}, nil, err
					}
					return handlerauth.CommittedFailure[subscriptionspec.OrgSubscription](details), nil, nil
				}
				if len(transitions) == 0 && decision.Outcome == billing.Unchanged {
					return result{
						Status: http.StatusOK,
						Body: responseFromState(
							advanced, seats, locked.GoogleSignInEnabled,
						),
					}, nil, nil
				}
				if err := billingdb.Save(ctx, q, change(
					s, identity.OrgDID, state, advanced, decision.State,
					transitions, decision.Transition, actor, pgtype.UUID{}, key,
				)); err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusOK,
					Body: responseFromState(
						decision.State, seats, locked.GoogleSignInEnabled,
					),
				}, nil, nil
			},
		)
	}
}

func PayInvoice(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.PayInvoiceRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		key, ok := handlerauth.IdempotencyKey(s, w, r)
		if !ok {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		actor := billing.OrgUserActor(dbvalue.FormatUUID(identity.UserID))
		type result = handlerauth.Result[subscriptionspec.OrgSubscription]
		handlerauth.RunIdempotent(
			s, w, r, "orgs:pay-invoice",
			dbvalue.FormatUUID(identity.UserID), key, request,
			s.CurrentTime().Add(24*time.Hour),
			func(q *sqlc.Queries) (result, *handlerauth.Problem, error) {
				ctx := r.Context()
				locked, err := q.LockOrgSubscriptionForChange(ctx, identity.OrgDID)
				if errors.Is(err, pgx.ErrNoRows) {
					return handlerauth.AuthenticationFailure[subscriptionspec.OrgSubscription](
						orgsproblem.AuthenticationRequiredError,
						orgsauthn.BearerChallenge,
					)
				}
				if err != nil {
					return result{}, nil, err
				}
				seats, err := q.GetOrgSeatsInUse(ctx, identity.OrgDID)
				if err != nil {
					return result{}, nil, err
				}
				state, err := billing.StateFromStored(
					billingdb.StoredFromRow(identity.OrgDID, sqlc.GetOrgSubscriptionRow(locked)),
				)
				if err != nil {
					return result{}, nil, err
				}
				at := billing.Instant(s.CurrentTime())
				advanced, transitions := billing.Advance(state, at, s.Billing, s.Charger)

				// A refusal still commits any transition that fell due: the
				// deadline may have passed while the request was in flight.
				refuse := func(details problem.Body) (result, *handlerauth.Problem, error) {
					if len(transitions) == 0 {
						return handlerauth.Failure[subscriptionspec.OrgSubscription](details)
					}
					if err := billingdb.Save(ctx, q, change(
						s, identity.OrgDID, state, advanced, advanced,
						transitions, nil, actor, pgtype.UUID{}, key,
					)); err != nil {
						return result{}, nil, err
					}
					return handlerauth.CommittedFailure[subscriptionspec.OrgSubscription](details), nil, nil
				}
				if !advanced.PastDue() || advanced.Open.ID != request.InvoiceID {
					return refuse(orgsproblem.InvoiceNotOpenError)
				}
				paid, paidTransition, outcome := billing.Pay(advanced, at, s.Charger)
				switch outcome {
				case billing.ChargeNoPaymentMethod:
					return refuse(orgsproblem.PaymentMethodRequiredError)
				case billing.ChargeDeclined:
					return refuse(orgsproblem.PaymentDeclinedError)
				}
				if err := billingdb.Save(ctx, q, change(
					s, identity.OrgDID, state, advanced, paid,
					transitions, paidTransition, actor, identity.UserID, key,
				)); err != nil {
					return result{}, nil, err
				}
				return result{
					Status: http.StatusOK,
					Body: responseFromState(
						paid, seats, locked.GoogleSignInEnabled,
					),
				}, nil, nil
			},
		)
	}
}

func SetPaymentMethod(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.SetPaymentMethodRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		if err := s.Queries.SetOrgPaymentMethod(
			r.Context(), sqlc.SetOrgPaymentMethodParams{
				OrgDid:         identity.OrgDID,
				Kind:           string(request.Kind),
				ActorOrgUserID: identity.UserID,
				TenantID:       s.TenantID,
			},
		); err != nil {
			s.InternalError(r.Context(), w, "set Org payment method", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(
			r.Context(), w, http.StatusOK,
			subscriptionspec.OrgPaymentMethod(request),
		)
	}
}

func RemovePaymentMethod(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		if err := s.Queries.RemoveOrgPaymentMethod(
			r.Context(), sqlc.RemoveOrgPaymentMethodParams{
				OrgDid:         identity.OrgDID,
				ActorOrgUserID: identity.UserID,
				TenantID:       s.TenantID,
			},
		); err != nil {
			s.InternalError(r.Context(), w, "remove Org payment method", err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}

type invoicesPaginationPayload struct {
	BeforeCreatedAt time.Time `json:"before_created_at"`
	BeforeInvoiceID string    `json:"before_invoice_id"`
}

func ListInvoices(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var request subscriptionspec.ListInvoicesRequest
		if !apiserver.Decode(s, w, r, &request) {
			return
		}
		identity, _ := middleware.OrgIdentityFromContext(r.Context())
		params := sqlc.ListOrgInvoicesParams{
			OrgDid:    identity.OrgDID,
			PageLimit: int32(request.EffectiveLimit()) + 1,
		}
		if request.PaginationKey != nil {
			payload, ok := credentials.VerifySignedValue(
				s.CredentialSubkey("pagination"), invoicesPaginationPurpose,
				string(*request.PaginationKey),
			)
			var decoded invoicesPaginationPayload
			if ok {
				ok = json.Unmarshal(payload, &decoded) == nil
			}
			invoiceID, parseErr := dbvalue.ParseUUID(decoded.BeforeInvoiceID)
			if !ok || parseErr != nil || decoded.BeforeCreatedAt.IsZero() {
				s.Problem(r.Context(), w, problem.InvalidPaginationKeyError)
				return
			}
			params.BeforeCreatedAt = dbvalue.Timestamp(decoded.BeforeCreatedAt)
			params.BeforeOrgInvoiceID = invoiceID
		}
		rows, err := s.Queries.ListOrgInvoices(r.Context(), params)
		if err != nil {
			s.InternalError(r.Context(), w, "list Org invoices", err)
			return
		}
		limit := int(request.EffectiveLimit())
		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}
		response := subscriptionspec.ListInvoicesResponse{
			Invoices: make([]subscriptionspec.OrgInvoice, 0, len(rows)),
		}
		for _, row := range rows {
			invoice := billing.Invoice{
				ID:           dbvalue.FormatUUID(row.OrgInvoiceID),
				Plan:         subscriptionspec.Plan(row.OrgPlanOid),
				Interval:     subscriptionspec.BillingInterval(row.BillingInterval),
				PeriodStart:  row.PeriodStart.Time,
				PeriodEnd:    row.PeriodEnd.Time,
				Reason:       subscriptionspec.InvoiceReason(row.Reason),
				State:        subscriptionspec.InvoiceState(row.InvoiceState),
				CreatedAt:    row.CreatedAt.Time,
				DueAt:        row.DueAt.Time,
				PaidAt:       row.PaidAt.Time,
				AttemptCount: int(row.AttemptCount),
			}
			if row.LastFailure.Valid {
				invoice.LastFailure = subscriptionspec.InvoiceFailure(
					row.LastFailure.VetchiumOrgInvoiceFailure,
				)
			}
			response.Invoices = append(response.Invoices, invoiceResponse(invoice))
		}
		if hasMore {
			last := rows[len(rows)-1]
			payload, err := json.Marshal(invoicesPaginationPayload{
				BeforeCreatedAt: last.CreatedAt.Time.UTC(),
				BeforeInvoiceID: dbvalue.FormatUUID(last.OrgInvoiceID),
			})
			if err != nil {
				s.InternalError(r.Context(), w, "encode pagination key", err)
				return
			}
			next := common.PaginationKey(credentials.SignValue(
				s.CredentialSubkey("pagination"), invoicesPaginationPurpose,
				payload,
			))
			response.NextPaginationKey = &next
		}
		w.Header().Set("Cache-Control", "no-store")
		s.JSON(r.Context(), w, http.StatusOK, response)
	}
}
