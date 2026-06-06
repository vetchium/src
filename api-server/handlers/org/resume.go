package org

import (
	"context"
	"errors"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	awss3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func newResumeS3Client(cfg *server.StorageConfig) *awss3.Client {
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

// streamResume streams the resume object at resumeKey (in the org's home region
// S3) to the response, preserving the stored content type. Resumes are served
// through the API so HR and interviewers can preview/download them without a
// presigned URL.
func streamResume(ctx context.Context, w http.ResponseWriter, s *server.RegionalServer, resumeKey string) {
	orgRegion := globaldb.Region(middleware.OrgRegionFromContext(ctx))
	cfg := s.GetStorageConfig(orgRegion)
	if cfg == nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	out, err := newResumeS3Client(cfg).GetObject(ctx, &awss3.GetObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(resumeKey),
	})
	if err != nil {
		s.Logger(ctx).Error("failed to download resume", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	defer out.Body.Close()

	contentType := "application/octet-stream"
	if out.ContentType != nil && *out.ContentType != "" {
		contentType = *out.ContentType
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	if _, err := io.Copy(w, out.Body); err != nil {
		s.Logger(ctx).Error("failed to stream resume", "error", err)
	}
}

// CandidacyResume streams the candidate's resume for a candidacy. Route-gated on
// view-candidacies (HR); superadmin bypasses via the middleware.
func CandidacyResume(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
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
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		app, err := db.GetApplicationByID(ctx, candidacy.ApplicationID)
		if err != nil {
			s.Logger(ctx).Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		streamResume(ctx, w, s, app.ResumeS3Key)
	}
}

// InterviewResume streams the candidate's resume for an interview, so a panel
// member can review it. Caller must be on the panel or a superadmin.
func InterviewResume(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var interviewID pgtype.UUID
		if err := interviewID.Scan(r.PathValue("interviewId")); err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		db := s.RegionalForCtx(ctx)
		interview, err := db.GetInterview(ctx, interviewID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get interview", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		candidacy, err := db.GetCandidacy(ctx, interview.CandidacyID)
		if err != nil {
			s.Logger(ctx).Error("failed to get candidacy", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if candidacy.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if !requireInterviewerOrSuperadmin(ctx, w, s, db, interviewID, orgUser.OrgUserID) {
			return
		}
		app, err := db.GetApplicationByID(ctx, candidacy.ApplicationID)
		if err != nil {
			s.Logger(ctx).Error("failed to get application", "error", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		streamResume(ctx, w, s, app.ResumeS3Key)
	}
}
