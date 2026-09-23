package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/common"

	"backend/internal/service"
)

const domainRequestTimeout = 10 * time.Second

type domainSeeder struct {
	baseURL string
	token   string
	client  *http.Client
}

func runDomainSeed() error {
	settings, err := loadDomainSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()

	s := &domainSeeder{
		baseURL: settings.baseURL,
		client:  &http.Client{Timeout: domainRequestTimeout},
	}
	if err := s.login(ctx, settings.email, settings.password); err != nil {
		return err
	}
	return s.seedSignupDomains(ctx, settings.domains)
}

type domainSettings struct {
	baseURL, email, password string
	domains                  []string
}

func loadDomainSettings() (domainSettings, error) {
	var s domainSettings
	for name, target := range map[string]*string{
		"DEV_SEED_ADMIN_API_URL":  &s.baseURL,
		"DEV_SEED_ADMIN_EMAIL":    &s.email,
		"DEV_SEED_ADMIN_PASSWORD": &s.password,
	} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			return domainSettings{}, fmt.Errorf("missing %s", name)
		}
		*target = value
	}
	s.baseURL = strings.TrimRight(s.baseURL, "/")
	for _, domain := range strings.Split(os.Getenv("DEV_SEED_SIGNUP_DOMAINS"), ",") {
		domain = strings.TrimSpace(domain)
		if domain == "" {
			continue
		}
		if !hubsignupdomains.IsDomainName(hubsignupdomains.DomainName(domain)) {
			return domainSettings{}, fmt.Errorf("invalid signup domain %q", domain)
		}
		s.domains = append(s.domains, domain)
	}
	return s, nil
}

// login uses the administrator db-seed created. Development fixtures never
// enable TOTP, so a password login completes in one step; a totp_required
// answer means the fixture changed and the seed cannot continue.
func (s *domainSeeder) login(ctx context.Context, email, password string) error {
	var response adminauth.LoginAuthenticatedResponse
	status, err := s.call(ctx, "/api/admin/login", adminauth.LoginRequest{
		EmailAddress: common.EmailAddress(email),
		Password:     common.Password(password),
	}, &response)
	if err != nil {
		return err
	}
	if status != http.StatusOK ||
		response.AuthenticationState != adminauth.AuthenticationStateAuthenticated {
		return fmt.Errorf(
			"admin login for %q returned %d/%q",
			email, status, response.AuthenticationState,
		)
	}
	s.token = string(response.SessionToken)
	return nil
}

// seedSignupDomains puts each domain on the tenant's Hub signup allowlist. A
// domain that is already there is left as it is, so re-running the seed against
// a live tenant neither fails nor overwrites an administrator's later edit.
func (s *domainSeeder) seedSignupDomains(ctx context.Context, domains []string) error {
	for _, domain := range domains {
		status, err := s.call(
			ctx, "/api/admin/create-hub-signup-domain",
			hubsignupdomains.CreateRequest{
				Domain: hubsignupdomains.DomainName(domain),
			}, nil,
		)
		if err != nil {
			return err
		}
		switch status {
		case http.StatusCreated:
			log.Printf("seeded Hub signup domain %s", domain)
		case http.StatusConflict:
			log.Printf("Hub signup domain already present %s", domain)
		default:
			return fmt.Errorf(
				"create Hub signup domain %q returned %d", domain, status,
			)
		}
	}
	return nil
}

func (s *domainSeeder) call(
	ctx context.Context, path string, body any, response any,
) (int, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, s.baseURL+path, bytes.NewReader(payload),
	)
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		request.Header.Set("Authorization", "Bearer "+s.token)
	}
	result, err := s.client.Do(request)
	if err != nil {
		return 0, fmt.Errorf("POST %s: %w", path, err)
	}
	defer func() { _ = result.Body.Close() }()
	if response == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(result.Body, 1<<20))
		return result.StatusCode, nil
	}
	if result.StatusCode != http.StatusOK {
		return result.StatusCode, nil
	}
	if err := json.NewDecoder(
		io.LimitReader(result.Body, 1<<20),
	).Decode(response); err != nil {
		return result.StatusCode, fmt.Errorf("decode %s response: %w", path, err)
	}
	return result.StatusCode, nil
}
