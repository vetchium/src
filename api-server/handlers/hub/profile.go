package hub

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/image/webp"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	common "vetchium-api-server.typespec/common"
	hubtypes "vetchium-api-server.typespec/hub"
)

const (
	maxProfileImageSize = 5 * 1024 * 1024 // 5MB
	minImageDimension   = 200
	maxImageDimension   = 4096
)

// newProfileS3Client creates an S3 client from storage config.
func newProfileS3Client(cfg *server.StorageConfig) *s3.Client {
	endpoint := cfg.Endpoint
	return s3.New(s3.Options{
		BaseEndpoint: &endpoint,
		UsePathStyle: true,
		Region:       cfg.Region,
		Credentials: aws.NewCredentialsCache(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		),
	})
}

// uploadProfileImageToS3 uploads image bytes to S3.
func uploadProfileImageToS3(ctx context.Context, cfg *server.StorageConfig, key, contentType string, data []byte) error {
	client := newProfileS3Client(cfg)
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(cfg.Bucket),
		Key:           aws.String(key),
		Body:          bytes.NewReader(data),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(int64(len(data))),
	})
	return err
}

// deleteProfileImageFromS3 deletes an S3 object (best-effort).
func deleteProfileImageFromS3(ctx context.Context, cfg *server.StorageConfig, key string) error {
	client := newProfileS3Client(cfg)
	_, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	})
	return err
}

// downloadFromProfileS3 downloads an S3 object and returns its body.
func downloadFromProfileS3(ctx context.Context, cfg *server.StorageConfig, key string) (io.ReadCloser, error) {
	client := newProfileS3Client(cfg)
	result, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get S3 object: %w", err)
	}
	return result.Body, nil
}

// detectProfileImageContentType returns the MIME type from magic bytes.
// Returns an error if the format is not JPEG, PNG, or WEBP.
func detectProfileImageContentType(data []byte) (string, string, error) {
	if len(data) < 12 {
		return "", "", fmt.Errorf("file too small to detect type")
	}
	// PNG
	if bytes.HasPrefix(data, []byte{0x89, 0x50, 0x4E, 0x47}) {
		return "image/png", "png", nil
	}
	// JPEG
	if bytes.HasPrefix(data, []byte{0xFF, 0xD8}) {
		return "image/jpeg", "jpg", nil
	}
	// WebP: RIFF....WEBP
	if bytes.HasPrefix(data, []byte("RIFF")) && len(data) >= 12 && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "image/webp", "webp", nil
	}
	return "", "", fmt.Errorf("unsupported image format: must be JPEG, PNG, or WEBP")
}

// decodeImageDimensions returns the width and height of the image.
func decodeImageDimensions(data []byte, contentType string) (int, int, error) {
	reader := bytes.NewReader(data)
	if contentType == "image/webp" {
		cfg, err := webp.DecodeConfig(reader)
		if err != nil {
			return 0, 0, fmt.Errorf("failed to decode WEBP image: %w", err)
		}
		return cfg.Width, cfg.Height, nil
	}
	cfg, _, err := image.DecodeConfig(reader)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to decode image: %w", err)
	}
	return cfg.Width, cfg.Height, nil
}

// contentTypeFromKey returns the MIME type based on file extension.
func contentTypeFromKey(key string) string {
	ext := strings.ToLower(filepath.Ext(key))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

// buildOwnerView assembles HubProfileOwnerView from DB rows.
func buildOwnerView(profile regionaldb.GetMyHubProfileRow, displayNames []globaldb.HubUserDisplayName) hubtypes.HubProfileOwnerView {
	result := hubtypes.HubProfileOwnerView{
		Handle:            hubtypes.Handle(profile.Handle),
		HasProfilePicture: profile.ProfilePictureStorageKey.Valid,
		PreferredLanguage: common.LanguageCode(profile.PreferredLanguage),
	}

	if profile.ShortBio.Valid {
		result.ShortBio = &profile.ShortBio.String
	}
	if profile.LongBio.Valid {
		result.LongBio = &profile.LongBio.String
	}
	if profile.City.Valid {
		result.City = &profile.City.String
	}
	if profile.ResidentCountryCode.Valid {
		cc := hubtypes.CountryCode(profile.ResidentCountryCode.String)
		result.ResidentCountryCode = &cc
	}
	if profile.CreatedAt.Valid {
		result.CreatedAt = profile.CreatedAt.Time.UTC()
	}
	if profile.UpdatedAt.Valid {
		result.UpdatedAt = profile.UpdatedAt.Time.UTC()
	}

	result.DisplayNames = make([]hubtypes.DisplayNameEntry, 0, len(displayNames))
	for _, dn := range displayNames {
		result.DisplayNames = append(result.DisplayNames, hubtypes.DisplayNameEntry{
			LanguageCode: dn.LanguageCode,
			DisplayName:  hubtypes.DisplayName(dn.DisplayName),
			IsPreferred:  dn.IsPreferred,
		})
	}

	return result
}

// buildOwnerViewFromHubUser assembles HubProfileOwnerView from a full HubUser row + display names.
func buildOwnerViewFromHubUser(hubUser regionaldb.HubUser, displayNames []globaldb.HubUserDisplayName) hubtypes.HubProfileOwnerView {
	result := hubtypes.HubProfileOwnerView{
		Handle:            hubtypes.Handle(hubUser.Handle),
		HasProfilePicture: hubUser.ProfilePictureStorageKey.Valid,
		PreferredLanguage: common.LanguageCode(hubUser.PreferredLanguage),
	}

	if hubUser.ShortBio.Valid {
		result.ShortBio = &hubUser.ShortBio.String
	}
	if hubUser.LongBio.Valid {
		result.LongBio = &hubUser.LongBio.String
	}
	if hubUser.City.Valid {
		result.City = &hubUser.City.String
	}
	if hubUser.ResidentCountryCode.Valid {
		cc := hubtypes.CountryCode(hubUser.ResidentCountryCode.String)
		result.ResidentCountryCode = &cc
	}
	if hubUser.CreatedAt.Valid {
		result.CreatedAt = hubUser.CreatedAt.Time.UTC()
	}
	if hubUser.UpdatedAt.Valid {
		result.UpdatedAt = hubUser.UpdatedAt.Time.UTC()
	}

	result.DisplayNames = make([]hubtypes.DisplayNameEntry, 0, len(displayNames))
	for _, dn := range displayNames {
		result.DisplayNames = append(result.DisplayNames, hubtypes.DisplayNameEntry{
			LanguageCode: dn.LanguageCode,
			DisplayName:  hubtypes.DisplayName(dn.DisplayName),
			IsPreferred:  dn.IsPreferred,
		})
	}

	return result
}

// GetMyProfile handles GET /hub/get-my-profile
func GetMyProfile(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// One regional read
		profile, err := s.Regional.GetMyHubProfile(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get hub profile", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One global read
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get display names", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildOwnerView(profile, displayNames))
	}
}

// UpdateMyProfile handles POST /hub/update-my-profile
func UpdateMyProfile(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.UpdateMyProfileRequest
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

		// If display_names provided, do global write first then regional
		var prevDisplayNames []globaldb.HubUserDisplayName
		if req.DisplayNames != nil && len(req.DisplayNames) > 0 {
			// Fetch current display names for compensating transaction
			var fetchErr error
			prevDisplayNames, fetchErr = s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
			if fetchErr != nil {
				log.Error("failed to fetch current display names", "error", fetchErr)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Build arrays for bulk insert
			langCodes := make([]string, len(req.DisplayNames))
			displayNameStrs := make([]string, len(req.DisplayNames))
			isPreferreds := make([]bool, len(req.DisplayNames))
			for i, dn := range req.DisplayNames {
				langCodes[i] = dn.LanguageCode
				displayNameStrs[i] = string(dn.DisplayName)
				isPreferreds[i] = dn.IsPreferred
			}

			// Global tx: replace display names
			globalErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
				_, err := qtx.ReplaceHubUserDisplayNames(ctx, globaldb.ReplaceHubUserDisplayNamesParams{
					HubUserGlobalID: hubUser.HubUserGlobalID,
					LanguageCodes:   langCodes,
					DisplayNames:    displayNameStrs,
					IsPreferred:     isPreferreds,
				})
				return err
			})
			if globalErr != nil {
				log.Error("failed to replace display names", "error", globalErr)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		// Build the fields_updated list
		fieldsUpdated := []string{}
		if req.DisplayNames != nil {
			fieldsUpdated = append(fieldsUpdated, "display_names")
		}
		if req.ShortBio != nil {
			fieldsUpdated = append(fieldsUpdated, "short_bio")
		}
		if req.LongBio != nil {
			fieldsUpdated = append(fieldsUpdated, "long_bio")
		}
		if req.City != nil {
			fieldsUpdated = append(fieldsUpdated, "city")
		}
		if req.ResidentCountryCode != nil {
			fieldsUpdated = append(fieldsUpdated, "resident_country_code")
		}

		// Build pgtype nullable params for regional update
		var shortBioParam pgtype.Text
		if req.ShortBio != nil {
			shortBioParam = pgtype.Text{String: *req.ShortBio, Valid: true}
		}
		var longBioParam pgtype.Text
		if req.LongBio != nil {
			longBioParam = pgtype.Text{String: *req.LongBio, Valid: true}
		}
		var cityParam pgtype.Text
		if req.City != nil {
			cityParam = pgtype.Text{String: *req.City, Valid: true}
		}
		var countryParam pgtype.Text
		if req.ResidentCountryCode != nil {
			countryParam = pgtype.Text{String: string(*req.ResidentCountryCode), Valid: true}
		}

		auditData, _ := json.Marshal(map[string]any{
			"fields_updated": fieldsUpdated,
		})

		var updatedUser regionaldb.HubUser
		regionalErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			updatedUser, txErr = qtx.UpdateMyHubProfile(ctx, regionaldb.UpdateMyHubProfileParams{
				ShortBio:        shortBioParam,
				LongBio:         longBioParam,
				City:            cityParam,
				Country:         countryParam,
				HubUserGlobalID: hubUser.HubUserGlobalID,
			})
			if txErr != nil {
				return txErr
			}

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.update_profile",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})

		if regionalErr != nil {
			// If display_names was written globally, compensate
			if req.DisplayNames != nil && len(prevDisplayNames) > 0 {
				prevLangCodes := make([]string, len(prevDisplayNames))
				prevDNStrs := make([]string, len(prevDisplayNames))
				prevIsPreferred := make([]bool, len(prevDisplayNames))
				for i, dn := range prevDisplayNames {
					prevLangCodes[i] = dn.LanguageCode
					prevDNStrs[i] = dn.DisplayName
					prevIsPreferred[i] = dn.IsPreferred
				}
				compErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
					_, err := qtx.ReplaceHubUserDisplayNames(ctx, globaldb.ReplaceHubUserDisplayNamesParams{
						HubUserGlobalID: hubUser.HubUserGlobalID,
						LanguageCodes:   prevLangCodes,
						DisplayNames:    prevDNStrs,
						IsPreferred:     prevIsPreferred,
					})
					return err
				})
				if compErr != nil {
					log.Error("CONSISTENCY_ALERT: failed to compensate display names after regional write failure",
						"hub_user_global_id", hubUser.HubUserGlobalID,
						"compensating_error", compErr,
						"original_error", regionalErr,
					)
				}
			} else if req.DisplayNames != nil && len(req.DisplayNames) > 0 {
				// Had no prev display names — delete what we inserted
				compErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
					_, err := qtx.ReplaceHubUserDisplayNames(ctx, globaldb.ReplaceHubUserDisplayNamesParams{
						HubUserGlobalID: hubUser.HubUserGlobalID,
						LanguageCodes:   []string{},
						DisplayNames:    []string{},
						IsPreferred:     []bool{},
					})
					return err
				})
				if compErr != nil {
					log.Error("CONSISTENCY_ALERT: failed to compensate display names after regional write failure",
						"hub_user_global_id", hubUser.HubUserGlobalID,
						"compensating_error", compErr,
						"original_error", regionalErr,
					)
				}
			}

			log.Error("failed to update profile", "error", regionalErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch fresh display names after update
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch display names after update", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildOwnerViewFromHubUser(updatedUser, displayNames))
	}
}

// UploadProfilePicture handles POST /hub/upload-profile-picture
func UploadProfilePicture(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Get the home region from context (set by auth middleware)
		homeRegion := globaldb.Region(middleware.HubRegionFromContext(ctx))
		storageCfg := s.GetStorageConfig(homeRegion)
		if storageCfg == nil {
			log.Error("no S3 config for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Parse multipart form with 10MB max memory
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			log.Debug("failed to parse multipart form", "error", err)
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}

		file, _, err := r.FormFile("image")
		if err != nil {
			log.Debug("failed to get image from form", "error", err)
			http.Error(w, "image field is required", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Read bytes (capped at 5MB)
		limitedReader := io.LimitReader(file, maxProfileImageSize+1)
		fileBytes, err := io.ReadAll(limitedReader)
		if err != nil {
			log.Error("failed to read image file", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if len(fileBytes) > maxProfileImageSize {
			http.Error(w, "image must be 5 MB or smaller", http.StatusBadRequest)
			return
		}

		// Detect MIME type
		contentType, ext, err := detectProfileImageContentType(fileBytes)
		if err != nil {
			log.Debug("unsupported image format", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Decode image dimensions
		width, height, err := decodeImageDimensions(fileBytes, contentType)
		if err != nil {
			log.Debug("failed to decode image dimensions", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if width < minImageDimension || height < minImageDimension {
			http.Error(w, fmt.Sprintf("image dimensions must be at least %d×%d pixels", minImageDimension, minImageDimension), http.StatusBadRequest)
			return
		}
		if width > maxImageDimension || height > maxImageDimension {
			http.Error(w, fmt.Sprintf("image dimensions must be at most %d×%d pixels", maxImageDimension, maxImageDimension), http.StatusBadRequest)
			return
		}

		// Generate storage key
		idStr := fmt.Sprintf("%x-%x-%x-%x-%x",
			hubUser.HubUserGlobalID.Bytes[0:4],
			hubUser.HubUserGlobalID.Bytes[4:6],
			hubUser.HubUserGlobalID.Bytes[6:8],
			hubUser.HubUserGlobalID.Bytes[8:10],
			hubUser.HubUserGlobalID.Bytes[10:16],
		)
		randBytes := make([]byte, 16)
		if _, err := rand.Read(randBytes); err != nil {
			log.Error("failed to generate random storage key suffix", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		newKey := fmt.Sprintf("hub-profile-pictures/%s/%s.%s", idStr, hex.EncodeToString(randBytes), ext)

		// Upload to S3
		if err := uploadProfileImageToS3(ctx, storageCfg, newKey, contentType, fileBytes); err != nil {
			log.Error("failed to upload profile picture to S3", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Regional tx: set new key, enqueue old key for cleanup, write audit log
		var priorKey pgtype.Text
		regionalErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// SetHubProfilePictureKey returns prior key (before update)
			// We need to get current key first to capture prior
			currentKeyResult, err := qtx.GetHubProfilePictureKey(ctx, hubUser.HubUserGlobalID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			priorKey = currentKeyResult

			// Set new key
			_, err = qtx.SetHubProfilePictureKey(ctx, regionaldb.SetHubProfilePictureKeyParams{
				StorageKey:      pgtype.Text{String: newKey, Valid: true},
				HubUserGlobalID: hubUser.HubUserGlobalID,
			})
			if err != nil {
				return err
			}

			// Enqueue prior key for cleanup if it existed
			if priorKey.Valid && priorKey.String != "" {
				if err := qtx.EnqueueStorageCleanup(ctx, regionaldb.EnqueueStorageCleanupParams{
					StorageKey: priorKey.String,
					Reason:     "profile_picture_replaced",
				}); err != nil {
					return err
				}
			}

			// Build audit data
			auditDataMap := map[string]any{
				"new_storage_key": newKey,
			}
			if priorKey.Valid && priorKey.String != "" {
				auditDataMap["prior_storage_key"] = priorKey.String
			} else {
				auditDataMap["prior_storage_key"] = nil
			}
			auditData, _ := json.Marshal(auditDataMap)

			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.upload_profile_picture",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})

		if regionalErr != nil {
			// Best-effort delete the uploaded S3 object
			if delErr := deleteProfileImageFromS3(ctx, storageCfg, newKey); delErr != nil {
				log.Error("failed to delete orphaned S3 object after tx failure", "key", newKey, "error", delErr)
			}
			log.Error("failed to update profile picture key in DB", "error", regionalErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch full profile for response
		profileRow, err := s.Regional.GetMyHubProfile(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch profile after picture upload", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch display names after picture upload", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildOwnerView(profileRow, displayNames))
	}
}

// RemoveProfilePicture handles POST /hub/remove-profile-picture
func RemoveProfilePicture(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var priorKey pgtype.Text
		var hadPicture bool

		regionalErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Read current key
			currentKey, err := qtx.GetHubProfilePictureKey(ctx, hubUser.HubUserGlobalID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return nil // user not found — treat as no-op
				}
				return err
			}

			if !currentKey.Valid || currentKey.String == "" {
				// No picture — no-op
				return nil
			}

			priorKey = currentKey
			hadPicture = true

			// Clear the key
			_, err = qtx.ClearHubProfilePictureKey(ctx, hubUser.HubUserGlobalID)
			if err != nil {
				return err
			}

			// Enqueue for cleanup
			if err := qtx.EnqueueStorageCleanup(ctx, regionaldb.EnqueueStorageCleanupParams{
				StorageKey: priorKey.String,
				Reason:     "profile_picture_removed",
			}); err != nil {
				return err
			}

			// Write audit log
			auditData, _ := json.Marshal(map[string]any{
				"prior_storage_key": priorKey.String,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.remove_profile_picture",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})

		if regionalErr != nil {
			log.Error("failed to remove profile picture", "error", regionalErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		_ = hadPicture

		// Fetch fresh profile for response
		profileRow, err := s.Regional.GetMyHubProfile(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch profile after picture removal", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, hubUser.HubUserGlobalID)
		if err != nil {
			log.Error("failed to fetch display names after picture removal", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildOwnerView(profileRow, displayNames))
	}
}

// GetProfile handles POST /hub/get-profile
func GetProfile(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.GetProfileRequest
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

		// One global read: resolve handle to region + global ID
		globalHubUser, err := s.Global.GetHubUserByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the target user's home region's DB queries. No proxy.
		homeRegion := globalHubUser.HomeRegion
		homeDB := s.GetRegionalDB(homeRegion)
		if homeDB == nil {
			log.Error("no regional pool for home region", "region", homeRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One regional read for the target user's home region
		publicProfile, err := homeDB.GetPublicProfileByHandle(ctx, string(req.Handle))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get public profile", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One global read: display names
		displayNames, err := s.Global.ListHubUserDisplayNames(ctx, publicProfile.HubUserGlobalID)
		if err != nil {
			log.Error("failed to get display names for profile", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Build public view
		result := hubtypes.HubProfilePublicView{
			Handle:       hubtypes.Handle(publicProfile.Handle),
			DisplayNames: make([]hubtypes.DisplayNameEntry, 0, len(displayNames)),
		}
		if publicProfile.ShortBio.Valid {
			result.ShortBio = &publicProfile.ShortBio.String
		}
		if publicProfile.LongBio.Valid {
			result.LongBio = &publicProfile.LongBio.String
		}
		if publicProfile.City.Valid {
			result.City = &publicProfile.City.String
		}
		if publicProfile.ResidentCountryCode.Valid {
			cc := hubtypes.CountryCode(publicProfile.ResidentCountryCode.String)
			result.ResidentCountryCode = &cc
		}
		if publicProfile.ProfilePictureStorageKey.Valid {
			picURL := fmt.Sprintf("/hub/profile-picture/%s", string(req.Handle))
			result.ProfilePictureURL = &picURL
		}
		for _, dn := range displayNames {
			result.DisplayNames = append(result.DisplayNames, hubtypes.DisplayNameEntry{
				LanguageCode: dn.LanguageCode,
				DisplayName:  hubtypes.DisplayName(dn.DisplayName),
				IsPreferred:  dn.IsPreferred,
			})
		}

		json.NewEncoder(w).Encode(result)
	}
}

// GetProfilePicture handles GET /hub/profile-picture/{handle}
func GetProfilePicture(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		handle := r.PathValue("handle")
		if handle == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// One global read: resolve handle to region
		globalHubUser, err := s.Global.GetHubUserByHandle(ctx, handle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to resolve handle for profile picture", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Select the target user's home region DB and S3 config. No proxy.
		targetRegion := globalHubUser.HomeRegion
		targetDB := s.GetRegionalDB(targetRegion)
		if targetDB == nil {
			log.Error("no regional pool for target region", "region", targetRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		targetStorageCfg := s.GetStorageConfig(targetRegion)
		if targetStorageCfg == nil {
			log.Error("no S3 config for target region", "region", targetRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// One regional read: get storage key for active user
		publicProfile, err := targetDB.GetPublicProfileByHandle(ctx, handle)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get profile for picture", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !publicProfile.ProfilePictureStorageKey.Valid || publicProfile.ProfilePictureStorageKey.String == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		s3Key := publicProfile.ProfilePictureStorageKey.String
		body, err := downloadFromProfileS3(ctx, targetStorageCfg, s3Key)
		if err != nil {
			log.Error("failed to download profile picture from S3", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		defer body.Close()

		contentType := contentTypeFromKey(s3Key)
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "private, max-age=300")
		if _, err := io.Copy(w, body); err != nil {
			log.Error("failed to stream profile picture", "error", err)
		}
	}
}
