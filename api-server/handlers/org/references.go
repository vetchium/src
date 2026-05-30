package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hub "vetchium-api-server.typespec/hub"
	org "vetchium-api-server.typespec/org"
)

func RequestReferences(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.OrgUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RequestReferencesRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(req.CandidacyID); err != nil {
			http.Error(w, "invalid candidacy_id", http.StatusBadRequest)
			return
		}

		var deadline pgtype.Date
		dl, err := time.Parse("2006-01-02", req.ResponseDeadline)
		if err != nil {
			http.Error(w, "invalid response_deadline, use YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		deadline = pgtype.Date{Time: dl, Valid: true}

		questionsJSON, err := json.Marshal(req.Questions)
		if err != nil {
			log.Error("failed to marshal questions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		db := s.RegionalForCtx(ctx)
		candidacy, err := db.GetCandidacy(ctx, candidacyID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != user.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if candidacy.State != "interviewing" && candidacy.State != "offered" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"candidacy_id": req.CandidacyID})
		var requestID string
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rr, txErr := qtx.CreateReferenceRequest(ctx, regionaldb.CreateReferenceRequestParams{
				CandidacyID:          candidacyID,
				RequestedByOrgUserID: user.OrgUserID,
				MaxReferences:        req.MaxReferences,
				ResponseDeadline:     deadline,
				Questions:            questionsJSON,
			})
			if txErr != nil {
				return txErr
			}
			requestID = rr.RequestID.String()

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.request_references",
				ActorUserID: user.OrgUserID,
				OrgID:       user.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			log.Error("failed to create reference request", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(org.RequestReferencesResponse{RequestID: requestID})
	}
}

func ListReferenceNominations(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.OrgUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RequestIdRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var reqID pgtype.UUID
		if err := reqID.Scan(req.RequestID); err != nil {
			http.Error(w, "invalid request_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)

		// Verify ownership via reference_request -> candidacy
		rr, err := db.GetReferenceRequest(ctx, reqID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get reference request", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		candidacy, err := db.GetCandidacy(ctx, rr.CandidacyID)
		if err != nil {
			log.Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != user.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		nominations, err := db.ListReferenceNominationsByRequestID(ctx, reqID)
		if err != nil {
			log.Error("failed to list nominations", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		result := make([]org.OrgReferenceNomination, 0, len(nominations))
		for _, n := range nominations {
			var submittedAt *string
			if n.SubmittedAt.Valid {
				s := n.SubmittedAt.Time.UTC().Format(time.RFC3339)
				submittedAt = &s
			}
			result = append(result, org.OrgReferenceNomination{
				NominationID:       n.NominationID.String(),
				NomineeHandle:      "",
				NomineeDisplayName: "",
				SharedDomain:       n.SharedDomain,
				OverlapStartYear:   n.OverlapStartYear,
				OverlapEndYear:     n.OverlapEndYear,
				State:              hub.ReferenceNominationState(n.State),
				NominatedAt:        n.NominatedAt.Time.UTC().Format(time.RFC3339),
				SubmittedAt:        submittedAt,
			})
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(org.ListReferenceNominationsResponse{Nominations: result})
	}
}

func ListReferenceResponses(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		user := middleware.OrgUserFromContext(ctx)
		if user == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req org.RequestIdRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var reqID pgtype.UUID
		if err := reqID.Scan(req.RequestID); err != nil {
			http.Error(w, "invalid request_id", http.StatusBadRequest)
			return
		}

		db := s.RegionalForCtx(ctx)

		// Verify ownership
		rr, err := db.GetReferenceRequest(ctx, reqID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get reference request", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		candidacy, err := db.GetCandidacy(ctx, rr.CandidacyID)
		if err != nil {
			log.Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != user.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		nominations, err := db.ListReferenceNominationsByRequestID(ctx, reqID)
		if err != nil {
			log.Error("failed to list nominations", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// Collect nomination IDs for bulk response lookup
		nominationIDs := make([]pgtype.UUID, 0, len(nominations))
		for _, n := range nominations {
			nominationIDs = append(nominationIDs, n.NominationID)
		}

		responses := []org.OrgReferenceResponse{}
		declined := []org.OrgReferenceNomination{}

		if len(nominationIDs) > 0 {
			rows, err := db.ListReferenceResponsesByNominationIDs(ctx, nominationIDs)
			if err != nil {
				log.Error("failed to list reference responses", "error", err)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}

			// Group answers by nomination_id
			answerMap := make(map[string][]org.ReferenceResponseAnswer)
			for _, row := range rows {
				nomID := row.NominationID.String()
				answerMap[nomID] = append(answerMap[nomID], org.ReferenceResponseAnswer{
					QuestionID:   row.QuestionID,
					QuestionText: "",
					ResponseText: row.ResponseText,
				})
			}

			for _, n := range nominations {
				nomID := n.NominationID.String()
				if n.State == "submitted" {
					var submittedAt string
					if n.SubmittedAt.Valid {
						submittedAt = n.SubmittedAt.Time.UTC().Format(time.RFC3339)
					}
					responses = append(responses, org.OrgReferenceResponse{
						NominationID:       nomID,
						NomineeHandle:      "",
						NomineeDisplayName: "",
						SharedDomain:       n.SharedDomain,
						OverlapStartYear:   n.OverlapStartYear,
						OverlapEndYear:     n.OverlapEndYear,
						Answers:            answerMap[nomID],
						SubmittedAt:        submittedAt,
					})
				} else if n.State == "declined" {
					var submittedAt *string
					if n.SubmittedAt.Valid {
						s := n.SubmittedAt.Time.UTC().Format(time.RFC3339)
						submittedAt = &s
					}
					declined = append(declined, org.OrgReferenceNomination{
						NominationID:       nomID,
						NomineeHandle:      "",
						NomineeDisplayName: "",
						SharedDomain:       n.SharedDomain,
						OverlapStartYear:   n.OverlapStartYear,
						OverlapEndYear:     n.OverlapEndYear,
						State:              hub.ReferenceNominationState(n.State),
						NominatedAt:        n.NominatedAt.Time.UTC().Format(time.RFC3339),
						SubmittedAt:        submittedAt,
					})
				}
			}
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(org.ListReferenceResponsesResponse{
			Responses:           responses,
			DeclinedNominations: declined,
		})
	}
}
