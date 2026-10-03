// Package mock is a development and CI OpenID Connect provider. It is a real
// provider in every respect the relying party can observe: it signs ID tokens
// with a key published at its JWKS endpoint, requires PKCE and the client
// secret, and issues single-use codes. It differs from Google only in having
// no user interface, so the account that signs in is chosen by the request
// that starts the sign-in.
//
// The authorization endpoint reads these query parameters beyond the
// standard ones: login_hint is the account's email address (required);
// mock_hd, mock_sub and mock_email_verified override the claims otherwise
// derived from the request.
//
// Nothing in the relying-party code knows this package exists, and no
// production binary imports it.
package mock

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const (
	keyID   = "mock-1"
	codeTTL = time.Minute
)

// Config describes the provider and the one client it serves. PublicURL is
// the address browsers use and the issuer ID tokens name; InternalURL is the
// address the relying party's server uses for the token and JWKS endpoints.
// They are equal outside Docker.
type Config struct {
	PublicURL    string
	InternalURL  string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

type grant struct {
	claims    map[string]any
	challenge string
	expires   time.Time
}

type Provider struct {
	cfg    Config
	key    *rsa.PrivateKey
	signer jose.Signer
	now    func() time.Time

	mu     sync.Mutex
	grants map[string]grant
}

func New(cfg Config) (*Provider, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	signer, err := jose.NewSigner(
		jose.SigningKey{
			Algorithm: jose.RS256,
			Key:       jose.JSONWebKey{Key: key, KeyID: keyID},
		},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		return nil, err
	}
	return &Provider{
		cfg: cfg, key: key, signer: signer, now: time.Now,
		grants: map[string]grant{},
	}, nil
}

func (p *Provider) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("GET /.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("GET /authorize", p.authorize)
	mux.HandleFunc("POST /token", p.token)
	mux.HandleFunc("GET /jwks", p.jwks)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (p *Provider) discovery(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                p.cfg.PublicURL,
		"authorization_endpoint":                p.cfg.PublicURL + "/authorize",
		"token_endpoint":                        p.cfg.InternalURL + "/token",
		"jwks_uri":                              p.cfg.InternalURL + "/jwks",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"code_challenge_methods_supported":      []string{"S256"},
	})
}

func (p *Provider) jwks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, jose.JSONWebKeySet{
		Keys: []jose.JSONWebKey{{
			Key: &p.key.PublicKey, KeyID: keyID, Algorithm: string(jose.RS256),
			Use: "sig",
		}},
	})
}

func (p *Provider) authorize(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if query.Get("client_id") != p.cfg.ClientID ||
		query.Get("redirect_uri") != p.cfg.RedirectURI ||
		query.Get("response_type") != "code" ||
		query.Get("code_challenge_method") != "S256" ||
		query.Get("code_challenge") == "" || query.Get("state") == "" ||
		query.Get("nonce") == "" || query.Get("login_hint") == "" {
		http.Error(w, "invalid authorization request", http.StatusBadRequest)
		return
	}
	email := query.Get("login_hint")
	subject := query.Get("mock_sub")
	if subject == "" {
		sum := sha256.Sum256([]byte(email))
		subject = "mock-" + hex.EncodeToString(sum[:8])
	}
	hostedDomain := query.Get("hd")
	if override, ok := query["mock_hd"]; ok {
		hostedDomain = override[0]
	}
	claims := map[string]any{
		"sub":            subject,
		"email":          email,
		"email_verified": query.Get("mock_email_verified") != "false",
		"nonce":          query.Get("nonce"),
	}
	if hostedDomain != "" {
		claims["hd"] = hostedDomain
	}
	code := randomCode()
	p.mu.Lock()
	p.grants[code] = grant{
		claims: claims, challenge: query.Get("code_challenge"),
		expires: p.now().Add(codeTTL),
	}
	p.mu.Unlock()

	target, err := url.Parse(p.cfg.RedirectURI)
	if err != nil {
		http.Error(w, "bad redirect", http.StatusInternalServerError)
		return
	}
	values := target.Query()
	values.Set("code", code)
	values.Set("state", query.Get("state"))
	target.RawQuery = values.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (p *Provider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		oauthError(w, "invalid_request")
		return
	}
	clientID, secret, ok := r.BasicAuth()
	if !ok {
		clientID, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if clientID != p.cfg.ClientID ||
		subtle.ConstantTimeCompare([]byte(secret), []byte(p.cfg.ClientSecret)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{
			"error": "invalid_client",
		})
		return
	}
	if r.PostForm.Get("grant_type") != "authorization_code" ||
		r.PostForm.Get("redirect_uri") != p.cfg.RedirectURI {
		oauthError(w, "invalid_request")
		return
	}
	code := r.PostForm.Get("code")
	p.mu.Lock()
	redeemed, found := p.grants[code]
	delete(p.grants, code)
	p.mu.Unlock()
	if !found || p.now().After(redeemed.expires) {
		oauthError(w, "invalid_grant")
		return
	}
	sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if base64.RawURLEncoding.EncodeToString(sum[:]) != redeemed.challenge {
		oauthError(w, "invalid_grant")
		return
	}
	issued := p.now()
	redeemed.claims["iss"] = p.cfg.PublicURL
	redeemed.claims["aud"] = p.cfg.ClientID
	redeemed.claims["iat"] = issued.Unix()
	redeemed.claims["exp"] = issued.Add(time.Hour).Unix()
	idToken, err := jwt.Signed(p.signer).Claims(redeemed.claims).Serialize()
	if err != nil {
		http.Error(w, "sign", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": randomCode(),
		"token_type":   "Bearer",
		"expires_in":   3600,
		"id_token":     idToken,
	})
}

func oauthError(w http.ResponseWriter, code string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": code})
}

func randomCode() string {
	buffer := make([]byte, 24)
	_, _ = rand.Read(buffer)
	return base64.RawURLEncoding.EncodeToString(buffer)
}
