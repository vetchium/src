package org

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	org "vetchium-api-server.typespec/org"
)

func newOfferS3Client(cfg *server.StorageConfig) *awss3.Client {
	endpoint := cfg.Endpoint
	return awss3.New(awss3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	})
}

func uploadOfferToS3(ctx context.Context, cfg *server.StorageConfig, key string, data []byte) error {
	client := newOfferS3Client(cfg)
	_, err := client.PutObject(ctx, &awss3.PutObjectInput{
		Bucket:        aws.String(cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String("application/pdf"),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}

func ExtendOffer(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if err := r.ParseMultipartForm(10 << 20); err != nil {
			log.Debug("failed to parse multipart form", "error", err)
			http.Error(w, "failed to parse form", http.StatusBadRequest)
			return
		}

		candidacyIDStr := r.FormValue("candidacy_id")
		if candidacyIDStr == "" {
			http.Error(w, "candidacy_id is required", http.StatusBadRequest)
			return
		}

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(candidacyIDStr); err != nil {
			http.Error(w, "invalid candidacy_id", http.StatusBadRequest)
			return
		}

		// Read offer letter file (max 5 MB)
		file, _, err := r.FormFile("offer_letter")
		if err != nil {
			http.Error(w, "offer_letter is required", http.StatusBadRequest)
			return
		}
		defer file.Close()

		fileBytes, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
		if err != nil {
			log.Debug("failed to read offer letter", "error", err)
			http.Error(w, "failed to read file", http.StatusBadRequest)
			return
		}
		if len(fileBytes) > 5*1024*1024 {
			http.Error(w, "offer letter must be ≤5 MB", http.StatusBadRequest)
			return
		}
		if !bytes.HasPrefix(fileBytes, []byte("%PDF")) {
			http.Error(w, "offer letter must be a PDF file", http.StatusBadRequest)
			return
		}

		// Optional fields
		var salaryCurrency pgtype.Text
		if v := r.FormValue("salary_currency"); v != "" {
			salaryCurrency.Scan(v)
		}
		var salaryAmount pgtype.Numeric
		if v := r.FormValue("salary_amount"); v != "" {
			salaryAmount.Scan(v)
		}
		var startDate pgtype.Date
		if v := r.FormValue("start_date"); v != "" {
			startDate.Scan(v)
		}
		var notes pgtype.Text
		if v := r.FormValue("notes"); v != "" {
			notes.Scan(v)
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
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if candidacy.State != "interviewing" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Upload offer letter to S3 before the transaction
		storageCfg := s.GetStorageConfig(s.CurrentRegion)
		if storageCfg == nil {
			log.Error("no S3 config for current region", "region", s.CurrentRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		s3Key := fmt.Sprintf("offers/%s/offer_letter.pdf", candidacyIDStr)
		if err := uploadOfferToS3(ctx, storageCfg, s3Key, fileBytes); err != nil {
			log.Error("failed to upload offer letter to S3", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]interface{}{"candidacy_id": candidacyIDStr})
		var extendedAt time.Time
		if err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Create offer record
			offer, txErr := qtx.CreateOffer(ctx, regionaldb.CreateOfferParams{
				CandidacyID:         candidacyID,
				OfferLetterS3Key:    s3Key,
				SalaryCurrency:      salaryCurrency,
				SalaryAmount:        salaryAmount,
				StartDate:           startDate,
				Notes:               notes,
				ExtendedByOrgUserID: orgUser.OrgUserID,
			})
			if txErr != nil {
				return txErr
			}
			extendedAt = offer.ExtendedAt.Time

			// Transition candidacy to offered
			if _, txErr := qtx.UpdateCandidacy(ctx, regionaldb.UpdateCandidacyParams{
				CandidacyID: candidacyID,
				State:       "offered",
			}); txErr != nil {
				return txErr
			}

			// Cancel all scheduled interviews
			if txErr := qtx.CancelAllScheduledForCandidacy(ctx, candidacyID); txErr != nil {
				return txErr
			}

			// Add system comment
			if _, txErr := qtx.AddSystemComment(ctx, regionaldb.AddSystemCommentParams{
				CandidacyID: candidacyID,
				Body:        "Offer extended.",
			}); txErr != nil {
				return txErr
			}

			if txErr := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.extend_offer",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}

			// Notify candidate
			hubUser, _ := qtx.GetHubUserByGlobalID(ctx, candidacy.ApplicantHubUserGlobalID)
			if hubUser.EmailAddress != "" {
				_, _ = qtx.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
					EmailType:     regionaldb.EmailTemplateTypeHubOfferExtended,
					EmailTo:       hubUser.EmailAddress,
					EmailSubject:  "Offer extended",
					EmailTextBody: "Congratulations! An offer has been extended for your candidacy. Please log in to view the details.",
					EmailHtmlBody: "<p>Congratulations! An offer has been extended for your candidacy. Please log in to view the details.</p>",
				})
			}
			return nil
		}); err != nil {
			log.Error("failed to extend offer", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(org.ExtendOfferResponse{
			CandidacyID: candidacyIDStr,
			ExtendedAt:  extendedAt.UTC().Format(time.RFC3339),
		})
	}
}
