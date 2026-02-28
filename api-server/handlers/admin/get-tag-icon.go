package admin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/server"
)

// GetTagIcon handles GET /public/tag-icon?tag_id=xxx&size=small|large
// This is an unauthenticated proxy that streams the icon from S3.
func GetTagIcon(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		log := s.Logger(ctx)

		tagID := r.URL.Query().Get("tag_id")
		size := r.URL.Query().Get("size")

		if tagID == "" {
			http.Error(w, "tag_id is required", http.StatusBadRequest)
			return
		}
		if size != "small" && size != "large" {
			http.Error(w, "size must be 'small' or 'large'", http.StatusBadRequest)
			return
		}

		tag, err := s.Global.GetTag(ctx, tagID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var s3Key string
		var contentType string

		if size == "small" {
			if !tag.SmallIconKey.Valid {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s3Key = tag.SmallIconKey.String
			if tag.SmallIconContentType.Valid {
				contentType = tag.SmallIconContentType.String
			}
		} else {
			if !tag.LargeIconKey.Valid {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s3Key = tag.LargeIconKey.String
			if tag.LargeIconContentType.Valid {
				contentType = tag.LargeIconContentType.String
			}
		}

		// Proxy from S3
		data, err := downloadFromS3(ctx, s.StorageConfig, s3Key)
		if err != nil {
			log.Error("failed to download icon from S3", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		defer data.Close()

		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		io.Copy(w, data)
	}
}

func downloadFromS3(ctx context.Context, cfg *server.StorageConfig, key string) (io.ReadCloser, error) {
	endpoint := cfg.Endpoint
	client := s3.New(s3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	})

	result, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get S3 object: %w", err)
	}
	return result.Body, nil
}
