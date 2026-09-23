// Package profileclient reads authenticated Hub profiles through a tenant's
// local relay or a mutually authenticated tenant peer.
package profileclient

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	hubspec "github.com/vetchium/src/typespec/hub"
	profilespec "github.com/vetchium/src/typespec/hub/profile"
	"github.com/vetchium/src/typespec/problem"
)

const maxProfileResponseBytes = 1 << 20

var ErrInvalidResponse = errors.New("invalid profile response")

type Outcome struct {
	Profile *profilespec.PublicProfile
	Problem *problem.Details
}

type Client struct {
	baseURL    string
	credential string
	baseTLS    *tls.Config
	timeout    time.Duration
}

func NewRelay(baseURL, credential string, timeout time.Duration) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		credential: credential,
		timeout:    timeout,
	}
}

func NewPeer(baseTLS *tls.Config, timeout time.Duration) *Client {
	return &Client{baseTLS: baseTLS, timeout: timeout}
}

func (c *Client) RelayRead(
	ctx context.Context, request profilespec.RelayReadProfileRequest,
) (Outcome, error) {
	return c.read(ctx, c.baseURL+"/mesh/profile/read", request, nil)
}

func (c *Client) PeerRead(
	ctx context.Context, tenant directoryspec.TenantID,
	request profilespec.PeerReadProfileRequest,
) (Outcome, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return Outcome{}, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return c.read(
		ctx, "https://"+name+":8443/api/mesh/profile/read",
		request, tlsConfig,
	)
}

func (c *Client) read(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (Outcome, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return Outcome{}, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return Outcome{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if c.credential != "" {
		request.Header.Set("Authorization", "Bearer "+c.credential)
	}
	transport := &http.Transport{TLSClientConfig: tlsConfig}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Timeout:   c.timeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return Outcome{}, fmt.Errorf("read profile: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(
		response.Body, maxProfileResponseBytes+1,
	))
	if err != nil {
		return Outcome{}, err
	}
	if len(data) > maxProfileResponseBytes {
		return Outcome{}, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode == http.StatusOK && mediaType == "application/json" {
		var profile profilespec.PublicProfile
		if err := decode(data, &profile); err != nil {
			return Outcome{}, err
		}
		if !hubspec.IsHubHandle(profile.Handle) ||
			profile.WorkExperiences == nil ||
			profile.Certifications == nil ||
			profile.LanguageAbilities == nil ||
			profile.EducationalQualifications == nil {
			return Outcome{}, fmt.Errorf("%w: missing public profile fields", ErrInvalidResponse)
		}
		return Outcome{Profile: &profile}, nil
	}
	if mediaType != problem.MediaType {
		return Outcome{}, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(data, &details); err != nil {
		return Outcome{}, err
	}
	if details.Status != response.StatusCode || details.Type == "" {
		return Outcome{}, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return Outcome{Problem: &details}, nil
}

func decode(body []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidResponse, err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("%w: trailing data", ErrInvalidResponse)
	}
	return nil
}
