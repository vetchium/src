// Command dev-seed applies local-development fixtures that must go through a
// portal API rather than straight into the database, so that the fixture is
// created by the same validation, authorization and audit path a real operator
// would use. Fixtures that are pure table content stay in db/db-seed instead.
//
// It is never built into a production image and never deployed.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	adminauth "github.com/vetchium/src/typespec/admin/auth"
	hubsignupdomains "github.com/vetchium/src/typespec/admin/hub-signup-domains"
	"github.com/vetchium/src/typespec/common"

	"backend/internal/service"
)

const requestTimeout = 10 * time.Second

func main() {
	service.MainWithoutServer("dev-seed", run)
}

type seeder struct {
	baseURL string
	token   string
	client  *http.Client
	log     *slog.Logger
}

func run(log *slog.Logger) error {
	settings, err := loadSettings()
	if err != nil {
		return err
	}
	ctx, stop := service.SignalContext()
	defer stop()

	s := &seeder{
		baseURL: settings.baseURL,
		client:  &http.Client{Timeout: requestTimeout},
		log:     log,
	}
	if err := s.login(ctx, settings.email, settings.password); err != nil {
		return err
	}
	return s.seedSignupDomains(ctx, settings.domains)
}

type settings struct {
	baseURL, email, password string
	domains                  []string
}

func loadSettings() (settings, error) {
	var s settings
	for name, target := range map[string]*string{
		"DEV_SEED_ADMIN_API_URL":  &s.baseURL,
		"DEV_SEED_ADMIN_EMAIL":    &s.email,
		"DEV_SEED_ADMIN_PASSWORD": &s.password,
	} {
		value := strings.TrimSpace(os.Getenv(name))
		if value == "" {
			return settings{}, fmt.Errorf("missing %s", name)
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
			return settings{}, fmt.Errorf("invalid signup domain %q", domain)
		}
		s.domains = append(s.domains, domain)
	}
	return s, nil
}

// login uses the administrator db-seed created. Development fixtures never
// enable TOTP, so a password login completes in one step; a totp_required
// answer means the fixture changed and the seed cannot continue.
func (s *seeder) login(ctx context.Context, email, password string) error {
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
func (s *seeder) seedSignupDomains(ctx context.Context, domains []string) error {
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
			s.log.Info(
				"seeded Hub signup domain",
				"event", "signup_domain_seeded", "domain", domain,
			)
		case http.StatusConflict:
			s.log.Info(
				"Hub signup domain already present",
				"event", "signup_domain_present", "domain", domain,
			)
		default:
			return fmt.Errorf(
				"create Hub signup domain %q returned %d", domain, status,
			)
		}
	}
	return nil
}

func (s *seeder) call(
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
