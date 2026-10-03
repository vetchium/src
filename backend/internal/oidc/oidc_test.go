package oidc_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"backend/internal/oidc"
	"backend/internal/oidc/mock"
)

const (
	clientID     = "vetchium-test"
	clientSecret = "test-secret"
	redirectURI  = "https://orgs.test/sso/google/callback"
)

// provider starts the mock behind an httptest server and returns a client
// for it plus the server address.
func provider(t *testing.T, tweak func(*mock.Config)) (*oidc.Client, string) {
	t.Helper()
	cfg := mock.Config{
		ClientID: clientID, ClientSecret: clientSecret, RedirectURI: redirectURI,
	}
	server := httptest.NewUnstartedServer(nil)
	server.Start()
	t.Cleanup(server.Close)
	cfg.PublicURL, cfg.InternalURL = server.URL, server.URL
	if tweak != nil {
		tweak(&cfg)
	}
	mocked, err := mock.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = mocked.Handler()
	return oidc.New(oidc.Config{
		Issuer: cfg.PublicURL, ClientID: clientID, ClientSecret: clientSecret,
		RedirectURI: redirectURI,
	}), server.URL
}

// authorize plays the browser: it follows the authorization URL for the
// chosen account without following the final redirect, and returns the code.
func authorize(t *testing.T, location string, extra url.Values) (code, state string) {
	t.Helper()
	target, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	query := target.Query()
	for key, values := range extra {
		query[key] = values
	}
	target.RawQuery = query.Encode()
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	response, err := client.Get(target.String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusFound {
		t.Fatalf("authorize status = %d", response.StatusCode)
	}
	redirect, err := url.Parse(response.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(redirect.String(), redirectURI+"?") {
		t.Fatalf("redirected to %q", redirect)
	}
	return redirect.Query().Get("code"), redirect.Query().Get("state")
}

func begin(t *testing.T, client *oidc.Client, hostedDomain string) (location, verifier, nonce string) {
	t.Helper()
	verifier, nonce = client.NewVerifier(), "nonce-value-nonce-value"
	location, err := client.AuthorizationURL(
		context.Background(), "state-value", nonce, verifier, hostedDomain,
	)
	if err != nil {
		t.Fatal(err)
	}
	return location, verifier, nonce
}

func TestExchangeReturnsTheVerifiedClaims(t *testing.T) {
	t.Parallel()
	client, _ := provider(t, nil)
	location, verifier, nonce := begin(t, client, "acme.example")
	code, state := authorize(t, location, url.Values{
		"login_hint": {"ada@acme.example"},
	})
	if state != "state-value" {
		t.Fatalf("state = %q", state)
	}
	claims, err := client.Exchange(context.Background(), code, verifier)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Email != "ada@acme.example" || !claims.EmailVerified ||
		claims.HostedDomain != "acme.example" || claims.Nonce != nonce ||
		claims.Subject == "" {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestAuthorizationURLCarriesPKCEAndTheHint(t *testing.T) {
	t.Parallel()
	client, _ := provider(t, nil)
	location, _, _ := begin(t, client, "acme.example")
	query, err := url.Parse(location)
	if err != nil {
		t.Fatal(err)
	}
	values := query.Query()
	for key, want := range map[string]string{
		"response_type": "code", "client_id": clientID, "redirect_uri": redirectURI,
		"code_challenge_method": "S256", "hd": "acme.example",
		"scope": "openid email", "state": "state-value",
	} {
		if values.Get(key) != want {
			t.Errorf("%s = %q, want %q", key, values.Get(key), want)
		}
	}
	if values.Get("code_challenge") == "" || values.Get("nonce") == "" {
		t.Errorf("missing PKCE challenge or nonce in %q", location)
	}
}

func TestClaimOverridesPassThroughForRefusalTests(t *testing.T) {
	t.Parallel()
	client, _ := provider(t, nil)
	location, verifier, _ := begin(t, client, "acme.example")
	code, _ := authorize(t, location, url.Values{
		"login_hint": {"ada@acme.example"}, "mock_hd": {"other.example"},
		"mock_email_verified": {"false"}, "mock_sub": {"fixed-subject"},
	})
	claims, err := client.Exchange(context.Background(), code, verifier)
	if err != nil {
		t.Fatal(err)
	}
	if claims.HostedDomain != "other.example" || claims.EmailVerified ||
		claims.Subject != "fixed-subject" {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestExchangeRefusals(t *testing.T) {
	t.Parallel()
	t.Run("wrong PKCE verifier", func(t *testing.T) {
		t.Parallel()
		client, _ := provider(t, nil)
		location, _, _ := begin(t, client, "acme.example")
		code, _ := authorize(t, location, url.Values{"login_hint": {"a@acme.example"}})
		_, err := client.Exchange(context.Background(), code, client.NewVerifier())
		if !errors.Is(err, oidc.ErrExchange) {
			t.Fatalf("Exchange() error = %v", err)
		}
	})
	t.Run("code used twice", func(t *testing.T) {
		t.Parallel()
		client, _ := provider(t, nil)
		location, verifier, _ := begin(t, client, "acme.example")
		code, _ := authorize(t, location, url.Values{"login_hint": {"a@acme.example"}})
		if _, err := client.Exchange(context.Background(), code, verifier); err != nil {
			t.Fatal(err)
		}
		if _, err := client.Exchange(context.Background(), code, verifier); !errors.Is(err, oidc.ErrExchange) {
			t.Fatalf("second Exchange() error = %v", err)
		}
	})
	t.Run("wrong client secret", func(t *testing.T) {
		t.Parallel()
		_, address := provider(t, nil)
		client := oidc.New(oidc.Config{
			Issuer: address, ClientID: clientID, ClientSecret: "wrong",
			RedirectURI: redirectURI,
		})
		location, verifier, _ := begin(t, client, "acme.example")
		code, _ := authorize(t, location, url.Values{"login_hint": {"a@acme.example"}})
		if _, err := client.Exchange(context.Background(), code, verifier); !errors.Is(err, oidc.ErrExchange) {
			t.Fatalf("Exchange() error = %v", err)
		}
	})
	t.Run("token for another audience", func(t *testing.T) {
		t.Parallel()
		_, address := provider(t, nil)
		// The relying party is registered under another client ID, so the
		// provider refuses before it could mint a token for the wrong one.
		client := oidc.New(oidc.Config{
			Issuer: address, ClientID: "someone-else", ClientSecret: clientSecret,
			RedirectURI: redirectURI,
		})
		location, verifier, _ := begin(t, client, "acme.example")
		target, _ := url.Parse(location)
		response, err := http.Get(target.String())
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("authorize status = %d", response.StatusCode)
		}
		if _, err := client.Exchange(context.Background(), "x", verifier); !errors.Is(err, oidc.ErrExchange) {
			t.Fatalf("Exchange() error = %v", err)
		}
	})
}

func TestIssuerMismatchFailsDiscovery(t *testing.T) {
	t.Parallel()
	_, address := provider(t, func(cfg *mock.Config) {
		cfg.PublicURL = "https://impostor.example"
	})
	client := oidc.New(oidc.Config{
		Issuer: address, ClientID: clientID, ClientSecret: clientSecret,
		RedirectURI: redirectURI,
	})
	if _, err := client.AuthorizationURL(
		context.Background(), "s", "n", client.NewVerifier(), "acme.example",
	); err == nil {
		t.Fatal("discovery accepted a provider that names another issuer")
	}
}

func TestDiscoveryURLSplitsWhereWeFetchFromWhatTokensName(t *testing.T) {
	t.Parallel()
	server := httptest.NewUnstartedServer(nil)
	server.Start()
	t.Cleanup(server.Close)
	const public = "http://oidc.public.test"
	mocked, err := mock.New(mock.Config{
		PublicURL: public, InternalURL: server.URL, ClientID: clientID,
		ClientSecret: clientSecret, RedirectURI: redirectURI,
	})
	if err != nil {
		t.Fatal(err)
	}
	server.Config.Handler = mocked.Handler()
	client := oidc.New(oidc.Config{
		Issuer: public, DiscoveryURL: server.URL, ClientID: clientID,
		ClientSecret: clientSecret, RedirectURI: redirectURI,
	})
	location, verifier, _ := begin(t, client, "acme.example")
	if !strings.HasPrefix(location, public+"/authorize?") {
		t.Fatalf("authorization URL = %q, want the public address", location)
	}
	// The browser would reach the public address; this test reaches the same
	// handler through the internal one.
	internal := strings.Replace(location, public, server.URL, 1)
	code, _ := authorize(t, internal, url.Values{"login_hint": {"a@acme.example"}})
	if _, err := client.Exchange(context.Background(), code, verifier); err != nil {
		t.Fatalf("Exchange() = %v", err)
	}
}

func TestDiscoveryFailureIsNotCached(t *testing.T) {
	t.Parallel()
	var up bool
	var mocked *mock.Provider
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !up {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		mocked.Handler().ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	var err error
	mocked, err = mock.New(mock.Config{
		PublicURL: server.URL, InternalURL: server.URL, ClientID: clientID,
		ClientSecret: clientSecret, RedirectURI: redirectURI,
	})
	if err != nil {
		t.Fatal(err)
	}
	client := oidc.New(oidc.Config{
		Issuer: server.URL, ClientID: clientID, ClientSecret: clientSecret,
		RedirectURI: redirectURI,
	})
	if _, err := client.AuthorizationURL(
		context.Background(), "s", "n", client.NewVerifier(), "acme.example",
	); err == nil {
		t.Fatal("expected a discovery failure while the provider is down")
	}
	up = true
	if _, err := client.AuthorizationURL(
		context.Background(), "s", "n", client.NewVerifier(), "acme.example",
	); err != nil {
		t.Fatalf("provider came back but discovery still fails: %v", err)
	}
}
