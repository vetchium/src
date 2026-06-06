package org

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
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

func uploadOfferToS3(ctx context.Context, cfg *server.StorageConfig, key, contentType string, data []byte) error {
	client := newOfferS3Client(cfg)
	_, err := client.PutObject(ctx, &awss3.PutObjectInput{
		Bucket:        aws.String(cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}

func downloadOfferFromS3(ctx context.Context, cfg *server.StorageConfig, key string) (io.ReadCloser, error) {
	client := newOfferS3Client(cfg)
	out, err := client.GetObject(ctx, &awss3.GetObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, err
	}
	return out.Body, nil
}

// offerContentTypeForKey infers the response content type from the stored key's
// extension (.pdf or .md).
func offerContentTypeForKey(key string) string {
	if strings.HasSuffix(strings.ToLower(key), ".md") {
		return "text/markdown; charset=utf-8"
	}
	return "application/pdf"
}

// GetOfferLetter streams the offer letter document for a candidacy to an
// authorized org user (the candidacy must belong to the caller's org). Served
// through the API rather than a presigned URL so it works regardless of the
// internal vs host S3 endpoint split.
func GetOfferLetter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(r.PathValue("candidacyId")); err != nil {
			w.WriteHeader(http.StatusNotFound)
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
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		offer, err := db.GetOfferByCandidacyID(ctx, candidacyID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get offer", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		// The offer letter lives in the org's home region (where the candidacy
		// lives), not necessarily the region of the server handling this request.
		orgRegion := globaldb.Region(middleware.OrgRegionFromContext(ctx))
		cfg := s.GetStorageConfig(orgRegion)
		if cfg == nil {
			log.Error("no S3 config for org region", "region", orgRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		body, err := downloadOfferFromS3(ctx, cfg, offer.OfferLetterS3Key)
		if err != nil {
			log.Error("failed to download offer letter", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer body.Close()

		w.Header().Set("Content-Type", offerContentTypeForKey(offer.OfferLetterS3Key))
		w.Header().Set("Cache-Control", "private, max-age=300")
		if _, err := io.Copy(w, body); err != nil {
			log.Error("failed to stream offer letter", "error", err)
		}
	}
}

// detectOfferDocType validates the uploaded offer letter and returns its content
// type and file extension. PDFs are detected by magic bytes; Markdown is detected
// by a .md/.markdown filename plus valid UTF-8 content (Markdown has no magic
// bytes). Anything else is rejected.
func detectOfferDocType(data []byte, filename string) (contentType, ext string, err error) {
	if bytes.HasPrefix(bytes.TrimSpace(data), []byte("%PDF")) {
		return "application/pdf", "pdf", nil
	}
	lower := strings.ToLower(filename)
	if (strings.HasSuffix(lower, ".md") || strings.HasSuffix(lower, ".markdown")) &&
		utf8.Valid(data) {
		return "text/markdown; charset=utf-8", "md", nil
	}
	return "", "", fmt.Errorf("offer letter must be a PDF or Markdown (.md) file")
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
		file, fileHeader, err := r.FormFile("offer_letter")
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
		offerContentType, offerExt, err := detectOfferDocType(fileBytes, fileHeader.Filename)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Optional fields
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

		// Upload to the org's home region S3 (where the candidacy lives), not the
		// region of whichever load-balanced server is handling this request — so
		// the download (org or hub) finds it regardless of routing.
		orgRegion := globaldb.Region(middleware.OrgRegionFromContext(ctx))
		storageCfg := s.GetStorageConfig(orgRegion)
		if storageCfg == nil {
			log.Error("no S3 config for org region", "region", orgRegion)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		s3Key := fmt.Sprintf("offers/%s/offer_letter.%s", candidacyIDStr, offerExt)
		if err := uploadOfferToS3(ctx, storageCfg, s3Key, offerContentType, fileBytes); err != nil {
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
