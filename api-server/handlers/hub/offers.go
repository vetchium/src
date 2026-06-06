package hub

import (
	"net/http"
	"strings"

	"errors"

	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func newHubOfferS3Client(cfg *server.StorageConfig) *awss3.Client {
	endpoint := cfg.Endpoint
	return awss3.New(awss3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials: aws.NewCredentialsCache(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		),
	})
}

// GetOfferLetter streams the offer letter document for the candidate's own
// candidacy. Served through the API (not a presigned URL) so it works across the
// internal/host S3 endpoint split and stays scoped to the authenticated user.
func GetOfferLetter(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var candidacyID pgtype.UUID
		if err := candidacyID.Scan(r.PathValue("candidacyId")); err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Find the region that owns this candidacy and verify it belongs to the
		// calling candidate.
		regions, err := hubUserHiringRegions(ctx, s, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to resolve hiring regions", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		var db *regionaldb.Queries
		var region globaldb.Region
		for _, rg := range regions {
			rdb := s.GetRegionalDB(rg)
			if rdb == nil {
				continue
			}
			if _, qErr := rdb.GetCandidacyForHubUser(ctx, regionaldb.GetCandidacyForHubUserParams{
				CandidacyID:              candidacyID,
				ApplicantHubUserGlobalID: hubUser.HubUserGlobalID,
			}); qErr == nil {
				db = rdb
				region = rg
				break
			} else if !errors.Is(qErr, pgx.ErrNoRows) {
				log.Error("failed to get candidacy", "region", rg, "error", qErr)
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
		}
		if db == nil {
			w.WriteHeader(http.StatusNotFound)
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

		cfg := s.GetStorageConfig(region)
		if cfg == nil {
			log.Error("no S3 config for region", "region", region)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		client := newHubOfferS3Client(cfg)
		out, err := client.GetObject(ctx, &awss3.GetObjectInput{
			Bucket: aws.String(cfg.Bucket),
			Key:    aws.String(offer.OfferLetterS3Key),
		})
		if err != nil {
			log.Error("failed to download offer letter", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		defer out.Body.Close()

		contentType := "application/pdf"
		if strings.HasSuffix(strings.ToLower(offer.OfferLetterS3Key), ".md") {
			contentType = "text/markdown; charset=utf-8"
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=300")
		if _, err := io.Copy(w, out.Body); err != nil {
			log.Error("failed to stream offer letter", "error", err)
		}
	}
}
