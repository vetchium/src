package admin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

const maxIconFileSize = 5 * 1024 * 1024 // 5MB

// UploadTagIcon handles POST /admin/upload-tag-icon (multipart form-data)
// Fields: tag_id, icon_size ("small"|"large"), icon_file (file)
func UploadTagIcon(s *server.GlobalServer) http.HandlerFunc {
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

		// Parse multipart form with 10MB max memory
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			log.Debug("failed to parse multipart form", "error", err)
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}

		tagID := r.FormValue("tag_id")
		iconSize := r.FormValue("icon_size")

		if tagID == "" {
			http.Error(w, "tag_id is required", http.StatusBadRequest)
			return
		}
		if iconSize != "small" && iconSize != "large" {
			http.Error(w, "icon_size must be 'small' or 'large'", http.StatusBadRequest)
			return
		}

		file, _, err := r.FormFile("icon_file")
		if err != nil {
			log.Debug("failed to get icon_file from form", "error", err)
			http.Error(w, "icon_file is required", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Read file content with size limit
		limitedReader := io.LimitReader(file, maxIconFileSize+1)
		fileBytes, err := io.ReadAll(limitedReader)
		if err != nil {
			log.Error("failed to read icon file", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if len(fileBytes) > maxIconFileSize {
			http.Error(w, "icon file exceeds 5MB limit", http.StatusBadRequest)
			return
		}

		// Detect content type via magic bytes
		contentType, err := detectImageContentType(fileBytes)
		if err != nil {
			log.Debug("unsupported image format", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Check tag exists
		_, err = s.Global.GetTag(ctx, tagID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("tag not found", "tag_id", tagID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get tag", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Upload to S3
		s3Key := fmt.Sprintf("tags/%s/%s", tagID, iconSize)
		if err := uploadToS3(ctx, s.StorageConfig, s3Key, contentType, fileBytes); err != nil {
			log.Error("failed to upload icon to S3", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update DB
		iconKeyText := pgtype.Text{String: s3Key, Valid: true}
		contentTypeText := pgtype.Text{String: contentType, Valid: true}

		if iconSize == "small" {
			err = s.Global.UpdateTagSmallIcon(ctx, globaldb.UpdateTagSmallIconParams{
				TagID:                tagID,
				SmallIconKey:         iconKeyText,
				SmallIconContentType: contentTypeText,
			})
		} else {
			err = s.Global.UpdateTagLargeIcon(ctx, globaldb.UpdateTagLargeIconParams{
				TagID:                tagID,
				LargeIconKey:         iconKeyText,
				LargeIconContentType: contentTypeText,
			})
		}
		if err != nil {
			log.Error("failed to update tag icon in DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("tag icon uploaded", "tag_id", tagID, "icon_size", iconSize)
		w.WriteHeader(http.StatusOK)
	}
}

func detectImageContentType(data []byte) (string, error) {
	if len(data) < 4 {
		return "", fmt.Errorf("file too small to detect type")
	}

	// PNG: \x89PNG
	if bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47}) {
		return "image/png", nil
	}
	// JPEG: \xFF\xD8
	if bytes.HasPrefix(data, []byte{0xFF, 0xD8}) {
		return "image/jpeg", nil
	}
	// WebP: RIFF....WEBP
	if len(data) >= 12 && bytes.HasPrefix(data, []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "image/webp", nil
	}
	// SVG: starts with <?xml or <svg
	trimmed := bytes.TrimSpace(data)
	if bytes.HasPrefix(trimmed, []byte("<?xml")) || bytes.HasPrefix(trimmed, []byte("<svg")) {
		return "image/svg+xml", nil
	}

	return "", fmt.Errorf("unsupported image format: must be PNG, JPEG, WebP, or SVG")
}

func uploadToS3(ctx context.Context, cfg *server.StorageConfig, key, contentType string, data []byte) error {
	endpoint := cfg.Endpoint
	client := s3.New(s3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials:  aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	})

	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}
