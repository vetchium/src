package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// DeleteTagIcon handles POST /admin/delete-tag-icon
func DeleteTagIcon(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admin.DeleteTagIconRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		tag, err := s.Global.GetTag(ctx, req.TagID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("tag not found", "tag_id", req.TagID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if icon exists
		if req.IconSize == admin.IconSizeSmall && !tag.SmallIconKey.Valid {
			log.Debug("small icon not set", "tag_id", req.TagID)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if req.IconSize == admin.IconSizeLarge && !tag.LargeIconKey.Valid {
			log.Debug("large icon not set", "tag_id", req.TagID)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Delete from S3
		s3Key := fmt.Sprintf("tags/%s/%s", req.TagID, string(req.IconSize))
		if err := deleteFromS3(ctx, s.StorageConfig, s3Key); err != nil {
			log.Error("failed to delete icon from S3", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Clear from DB
		if req.IconSize == admin.IconSizeSmall {
			err = s.Global.ClearTagSmallIcon(ctx, req.TagID)
		} else {
			err = s.Global.ClearTagLargeIcon(ctx, req.TagID)
		}
		if err != nil {
			log.Error("failed to clear tag icon in DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("tag icon deleted", "tag_id", req.TagID, "icon_size", req.IconSize)
		w.WriteHeader(http.StatusOK)
	}
}

func deleteFromS3(ctx context.Context, cfg *server.StorageConfig, key string) error {
	endpoint := cfg.Endpoint
	client := s3.New(s3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	})

	_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	})
	return err
}
