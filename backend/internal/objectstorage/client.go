package objectstorage

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"backend/internal/dbvalue"
	"backend/internal/imagesanitize"
	"backend/internal/profilepicture"
)

const (
	bucketName     = "hub-profile-pictures"
	logoBucketName = "org-logos"
	readURLTTL     = 10 * time.Minute
)

type Client struct {
	private *minio.Client
	media   *minio.Client
}

func New(privateOrigin, mediaOrigin, accessKey, secretKey string) (*Client, error) {
	if len(accessKey) < 16 || len(secretKey) < 32 {
		return nil, fmt.Errorf("object-storage credentials are missing or too short")
	}
	privateEndpoint, privateTLS, err := parseOrigin(privateOrigin)
	if err != nil {
		return nil, fmt.Errorf("private object-storage origin: %w", err)
	}
	mediaEndpoint, mediaTLS, err := parseOrigin(mediaOrigin)
	if err != nil {
		return nil, fmt.Errorf("media origin: %w", err)
	}
	options := func(secure bool) *minio.Options {
		return &minio.Options{
			Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
			Secure: secure, Region: "us-east-1",
			BucketLookup: minio.BucketLookupPath,
		}
	}
	private, err := minio.New(privateEndpoint, options(privateTLS))
	if err != nil {
		return nil, fmt.Errorf("private object-storage client: %w", err)
	}
	media, err := minio.New(mediaEndpoint, options(mediaTLS))
	if err != nil {
		return nil, fmt.Errorf("media signer: %w", err)
	}
	return &Client{private: private, media: media}, nil
}

// EnsureBucket creates every bucket this tenant uses if it is missing.
func (c *Client) EnsureBucket(ctx context.Context) error {
	for _, bucket := range []string{bucketName, logoBucketName} {
		if err := c.ensureBucket(ctx, bucket); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) ensureBucket(ctx context.Context, bucket string) error {
	exists, err := c.private.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("check %s bucket: %w", bucket, err)
	}
	if exists {
		return nil
	}
	if err := c.private.MakeBucket(ctx, bucket, minio.MakeBucketOptions{
		Region: "us-east-1",
	}); err != nil {
		// Another tenant-local process may create the same bucket after our
		// existence check. Only an actual follow-up existence check is success.
		if exists, checkErr := c.private.BucketExists(ctx, bucket); checkErr == nil && exists {
			return nil
		}
		return fmt.Errorf("create %s bucket: %w", bucket, err)
	}
	return nil
}

func (c *Client) Put(ctx context.Context, id pgtype.UUID, picture profilepicture.Sanitized) error {
	if !id.Valid || len(picture.Bytes) == 0 {
		return fmt.Errorf("invalid profile-picture object")
	}
	_, err := c.private.PutObject(
		ctx, bucketName, dbvalue.FormatUUID(id), bytes.NewReader(picture.Bytes),
		int64(len(picture.Bytes)), minio.PutObjectOptions{
			ContentType: string(picture.ContentType),
		},
	)
	if err != nil {
		return fmt.Errorf("store profile picture: %w", err)
	}
	return nil
}

func (c *Client) Delete(ctx context.Context, id pgtype.UUID) error {
	if !id.Valid {
		return fmt.Errorf("invalid profile-picture object id")
	}
	if err := c.private.RemoveObject(ctx, bucketName, dbvalue.FormatUUID(id),
		minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete profile picture: %w", err)
	}
	return nil
}

// SignGet signs for the browser-visible origin, not the private S3 hostname;
// SigV4 includes Host, so rewriting the host after signing would invalidate it.
func (c *Client) SignGet(ctx context.Context, id pgtype.UUID) (string, error) {
	if !id.Valid {
		return "", fmt.Errorf("invalid profile-picture object id")
	}
	signed, err := c.media.PresignedGetObject(
		ctx, bucketName, dbvalue.FormatUUID(id), readURLTTL, nil,
	)
	if err != nil {
		return "", fmt.Errorf("sign profile-picture read URL: %w", err)
	}
	return signed.String(), nil
}

// PutLogo stores a sanitized Org logo.
func (c *Client) PutLogo(ctx context.Context, id pgtype.UUID, logo imagesanitize.Image) error {
	if !id.Valid || len(logo.Bytes) == 0 {
		return fmt.Errorf("invalid Org logo object")
	}
	_, err := c.private.PutObject(
		ctx, logoBucketName, dbvalue.FormatUUID(id), bytes.NewReader(logo.Bytes),
		int64(len(logo.Bytes)), minio.PutObjectOptions{ContentType: logo.ContentType},
	)
	if err != nil {
		return fmt.Errorf("store Org logo: %w", err)
	}
	return nil
}

func (c *Client) DeleteLogo(ctx context.Context, id pgtype.UUID) error {
	if !id.Valid {
		return fmt.Errorf("invalid Org logo object id")
	}
	if err := c.private.RemoveObject(ctx, logoBucketName, dbvalue.FormatUUID(id),
		minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete Org logo: %w", err)
	}
	return nil
}

// SignLogoGet signs a short-lived read URL for the browser-visible origin.
func (c *Client) SignLogoGet(ctx context.Context, id pgtype.UUID) (string, error) {
	if !id.Valid {
		return "", fmt.Errorf("invalid Org logo object id")
	}
	signed, err := c.media.PresignedGetObject(
		ctx, logoBucketName, dbvalue.FormatUUID(id), readURLTTL, nil,
	)
	if err != nil {
		return "", fmt.Errorf("sign Org logo read URL: %w", err)
	}
	return signed.String(), nil
}

func parseOrigin(raw string) (string, bool, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") ||
		u.Host == "" || u.User != nil || u.Path != "" ||
		u.RawPath != "" || u.RawQuery != "" || u.Fragment != "" ||
		strings.TrimSpace(raw) != raw {
		return "", false, fmt.Errorf("must be a bare HTTP(S) origin")
	}
	return u.Host, u.Scheme == "https", nil
}
