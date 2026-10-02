// Package oidc runs the OpenID Connect authorization code flow with PKCE and
// a nonce against one configured provider. It knows nothing about Orgs: the
// caller decides what a verified identity may do.
package oidc

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const requestTimeout = 10 * time.Second

// Config names the provider and this deployment's client at it. DiscoveryURL
// is empty when the provider is reached at its issuer address.
type Config struct {
	Issuer       string
	DiscoveryURL string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

// Claims is the verified identity an ID token carries. Nonce is returned for
// the caller to compare with the one it issued.
type Claims struct {
	Subject       string
	Email         string
	EmailVerified bool
	HostedDomain  string
	Nonce         string
}

// ErrExchange covers every failure to turn a code into a verified identity.
// Callers answer it generically; the wrapped error is for logs.
var ErrExchange = errors.New("oidc: code exchange failed")

type Client struct {
	cfg  Config
	http *http.Client

	mu       sync.Mutex
	provider *gooidc.Provider
}

func New(cfg Config) *Client {
	return &Client{cfg: cfg, http: &http.Client{Timeout: requestTimeout}}
}

// discover fetches the provider's metadata once it succeeds. A failure is not
// cached, so a provider that was down at start-up works when it returns.
func (c *Client) discover(ctx context.Context) (*gooidc.Provider, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.provider != nil {
		return c.provider, nil
	}
	ctx = gooidc.ClientContext(ctx, c.http)
	location := c.cfg.Issuer
	if c.cfg.DiscoveryURL != "" {
		location = c.cfg.DiscoveryURL
		ctx = gooidc.InsecureIssuerURLContext(ctx, c.cfg.Issuer)
	}
	provider, err := gooidc.NewProvider(ctx, location)
	if err != nil {
		return nil, fmt.Errorf("discover OIDC provider: %w", err)
	}
	c.provider = provider
	return provider, nil
}

func (c *Client) oauth(provider *gooidc.Provider) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     c.cfg.ClientID,
		ClientSecret: c.cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  c.cfg.RedirectURI,
		Scopes:       []string{gooidc.ScopeOpenID, "email"},
	}
}

// NewVerifier returns a fresh PKCE verifier.
func (*Client) NewVerifier() string { return oauth2.GenerateVerifier() }

// AuthorizationURL is where the browser goes to sign in. hostedDomain is
// only a hint to the account chooser; the ID token's claim is what counts.
func (c *Client) AuthorizationURL(
	ctx context.Context, state, nonce, verifier, hostedDomain string,
) (string, error) {
	provider, err := c.discover(ctx)
	if err != nil {
		return "", err
	}
	return c.oauth(provider).AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(verifier),
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("hd", hostedDomain),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	), nil
}

// Exchange redeems code and verifies the ID token's signature, issuer,
// audience and expiry.
func (c *Client) Exchange(
	ctx context.Context, code, verifier string,
) (Claims, error) {
	provider, err := c.discover(ctx)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrExchange, err)
	}
	ctx = gooidc.ClientContext(ctx, c.http)
	token, err := c.oauth(provider).Exchange(
		ctx, code, oauth2.VerifierOption(verifier),
	)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrExchange, err)
	}
	raw, _ := token.Extra("id_token").(string)
	if raw == "" {
		return Claims{}, fmt.Errorf("%w: no ID token", ErrExchange)
	}
	idToken, err := provider.Verifier(
		&gooidc.Config{ClientID: c.cfg.ClientID},
	).Verify(ctx, raw)
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrExchange, err)
	}
	var body struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		HostedDomain  string `json:"hd"`
	}
	if err := idToken.Claims(&body); err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrExchange, err)
	}
	return Claims{
		Subject:       idToken.Subject,
		Email:         body.Email,
		EmailVerified: body.EmailVerified,
		HostedDomain:  body.HostedDomain,
		Nonce:         idToken.Nonce,
	}, nil
}
