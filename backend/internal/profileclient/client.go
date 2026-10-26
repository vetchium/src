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
	"github.com/vetchium/src/typespec/orgs/marketplace/contacts"
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
	response, err := c.post(ctx, endpoint, payload, tlsConfig)
	if err != nil {
		return Outcome{}, err
	}
	if response.ok() {
		var profile profilespec.PublicProfile
		if err := decode(response.body, &profile); err != nil {
			return Outcome{}, err
		}
		if !validProfile(profile) {
			return Outcome{}, fmt.Errorf("%w: missing public profile fields", ErrInvalidResponse)
		}
		return Outcome{Profile: &profile}, nil
	}
	details, err := response.problem()
	return Outcome{Problem: details}, err
}

func validProfile(profile profilespec.PublicProfile) bool {
	return hubspec.IsHubHandle(profile.Handle) &&
		profile.Websites != nil &&
		profile.WorkExperiences != nil &&
		profile.Certifications != nil &&
		profile.LanguageAbilities != nil &&
		profile.EducationalQualifications != nil
}

// AgencyOutcome is a tenant's answer to an agency's profile read.
type AgencyOutcome struct {
	Read    *contacts.AgencyProfileRead
	Problem *problem.Details
}

// RelayAgencyRead asks the local mesh-api for a Hub user's profile on behalf
// of an agency Org of this tenant (MKT-PRF-001).
func (c *Client) RelayAgencyRead(
	ctx context.Context, request contacts.RelayReadAgencyProfileRequest,
) (AgencyOutcome, error) {
	return c.readAgency(ctx, c.baseURL+"/mesh/agency-profile/read", request, nil)
}

// PeerAgencyRead asks a Hub user's home tenant for the profile an agency
// Org of the calling tenant may read.
func (c *Client) PeerAgencyRead(
	ctx context.Context, tenant directoryspec.TenantID,
	request contacts.PeerReadAgencyProfileRequest,
) (AgencyOutcome, error) {
	if !directoryspec.IsTenantID(tenant) || c.baseTLS == nil {
		return AgencyOutcome{}, fmt.Errorf("%w: invalid peer configuration", ErrInvalidResponse)
	}
	name := string(tenant) + ".mesh.vetchium.com"
	tlsConfig := c.baseTLS.Clone()
	tlsConfig.ServerName = name
	return c.readAgency(ctx,
		"https://"+name+":8443/api/mesh/agency-profile/read", request, tlsConfig)
}

func (c *Client) readAgency(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (AgencyOutcome, error) {
	response, err := c.post(ctx, endpoint, payload, tlsConfig)
	if err != nil {
		return AgencyOutcome{}, err
	}
	if response.ok() {
		var read contacts.AgencyProfileRead
		if err := decode(response.body, &read); err != nil {
			return AgencyOutcome{}, err
		}
		if !read.Valid() {
			return AgencyOutcome{}, fmt.Errorf("%w: invalid agency profile", ErrInvalidResponse)
		}
		return AgencyOutcome{Read: &read}, nil
	}
	details, err := response.problem()
	return AgencyOutcome{Problem: details}, err
}

type reply struct {
	status    int
	mediaType string
	body      []byte
}

func (r reply) ok() bool {
	return r.status == http.StatusOK && r.mediaType == "application/json"
}

// problem parses a declared problem, holding it to the status it came with.
func (r reply) problem() (*problem.Details, error) {
	if r.mediaType != problem.MediaType {
		return nil, fmt.Errorf("%w: response type", ErrInvalidResponse)
	}
	var details problem.Details
	if err := decode(r.body, &details); err != nil {
		return nil, err
	}
	if details.Status != r.status || details.Type == "" {
		return nil, fmt.Errorf("%w: inconsistent problem", ErrInvalidResponse)
	}
	return &details, nil
}

func (c *Client) post(
	ctx context.Context, endpoint string, payload any, tlsConfig *tls.Config,
) (reply, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return reply{}, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(body),
	)
	if err != nil {
		return reply{}, err
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
		return reply{}, fmt.Errorf("read profile: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(
		response.Body, maxProfileResponseBytes+1,
	))
	if err != nil {
		return reply{}, err
	}
	if len(data) > maxProfileResponseBytes {
		return reply{}, fmt.Errorf("%w: body too large", ErrInvalidResponse)
	}
	mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	return reply{status: response.StatusCode, mediaType: mediaType, body: data}, nil
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
