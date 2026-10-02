package appconfig

import (
	"bytes"
	"encoding/json"
	"maps"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"

	"backend/internal/regions"
)

type portalRegionTable struct {
	DefaultTenant   string            `json:"defaultTenant"`
	Recommendations map[string]string `json:"recommendations"`
	Regions         []struct {
		TenantID         string   `json:"tenantId"`
		HostingCountry   string   `json:"hostingCountry"`
		APIOrigin        string   `json:"apiOrigin"`
		SignupEnabled    bool     `json:"signupEnabled"`
		OrgSignupEnabled bool     `json:"orgSignupEnabled"`
		AllowedCountries []string `json:"allowedCountries"`
	} `json:"regions"`
}

type hubRegionTable struct {
	Regions []struct {
		TenantID    string   `json:"tenantId"`
		MediaOrigin string   `json:"mediaOrigin"`
		HubPlans    []string `json:"hubPlans"`
	} `json:"regions"`
}

type orgRegionTable struct {
	Regions []struct {
		TenantID string   `json:"tenantId"`
		OrgPlans []string `json:"orgPlans"`
	} `json:"regions"`
}

// TestPortalRegionTablesMatchCheckedInConfiguration keeps the region tables
// compiled into the global Hub and Orgs portals equal to each environment's
// tenant configs and signup-regions catalog. The portals are static files
// with no server to compare them against at startup, so this repository test
// is what catches drift before a build is published.
func TestPortalRegionTablesMatchCheckedInConfiguration(t *testing.T) {
	root := filepath.Join("..", "..", "..")
	for _, env := range []struct {
		name        string
		configGlob  string
		catalogPath string
		traefikPath func(tenant string) string
	}{
		{
			"dev",
			filepath.Join(root, "config", "*.json"),
			filepath.Join(root, "config", "signup-regions.json"),
			func(tenant string) string {
				return filepath.Join(root, "traefik", tenant+".json")
			},
		},
		{
			"ci",
			filepath.Join(root, "config", "ci", "*.json"),
			filepath.Join(root, "config", "ci", "signup-regions.json"),
			func(tenant string) string {
				return filepath.Join(root, "traefik", tenant+".json")
			},
		},
		{
			"production",
			filepath.Join(root, "deploy", "*", "config.json"),
			filepath.Join(root, "deploy", "signup-regions.json"),
			func(tenant string) string {
				return filepath.Join(root, "deploy", tenant, "traefik.json")
			},
		},
	} {
		t.Run(env.name, func(t *testing.T) {
			configs := tenantConfigs(t, env.configGlob)
			catalog, err := regions.Load(env.catalogPath)
			if err != nil {
				t.Fatal(err)
			}
			var portal portalRegionTable
			decodeStrict(t, filepath.Join(
				root, "portal-ui", "src", "regions", env.name+".json",
			), &portal)
			var hub hubRegionTable
			decodeStrict(t, filepath.Join(
				root, "hub-ui", "src", "app", "regions", env.name+".json",
			), &hub)

			var org orgRegionTable
			decodeStrict(t, filepath.Join(
				root, "orgs-ui", "src", "app", "regions", env.name+".json",
			), &org)

			wantTenants := slices.Sorted(maps.Keys(configs))
			catalogTenants := make([]string, 0, len(catalog.Regions))
			for _, region := range catalog.Regions {
				catalogTenants = append(catalogTenants, region.TenantID)
			}
			slices.Sort(catalogTenants)
			if !slices.Equal(catalogTenants, wantTenants) {
				t.Fatalf(
					"catalog regions = %v, want config tenants %v",
					catalogTenants, wantTenants,
				)
			}

			if portal.DefaultTenant != catalog.DefaultTenant {
				t.Errorf(
					"defaultTenant = %q, want %q",
					portal.DefaultTenant, catalog.DefaultTenant,
				)
			}
			wantRecommendations := make(map[string]string)
			for country, tenant := range catalog.Recommendations {
				wantRecommendations[string(country)] = tenant
			}
			if !maps.Equal(portal.Recommendations, wantRecommendations) {
				t.Errorf(
					"recommendations = %v, want %v",
					portal.Recommendations, wantRecommendations,
				)
			}

			portalTenants := make([]string, 0, len(portal.Regions))
			apiOrigins := make(map[string]bool)
			for _, got := range portal.Regions {
				portalTenants = append(portalTenants, got.TenantID)
				want, ok := catalog.Region(got.TenantID)
				if !ok {
					continue
				}
				if got.HostingCountry != string(want.HostingCountry) ||
					got.SignupEnabled != want.SignupEnabled ||
					got.OrgSignupEnabled != want.OrgSignupEnabled ||
					!slices.Equal(
						got.AllowedCountries, countryStrings(want.AllowedCountries),
					) {
					t.Errorf(
						"portal region %q = %+v, want catalog entry %+v",
						got.TenantID, got, want,
					)
				}
				if !isAPIOrigin(got.APIOrigin, env.name == "production") ||
					apiOrigins[got.APIOrigin] {
					t.Errorf(
						"portal region %q apiOrigin %q must be a unique origin, HTTPS in production",
						got.TenantID, got.APIOrigin,
					)
				}
				apiOrigins[got.APIOrigin] = true
				if cfg, ok := configs[got.TenantID]; ok {
					checkRegionalIngress(
						t, env.traefikPath(got.TenantID), got.APIOrigin, cfg,
					)
				}
			}
			slices.Sort(portalTenants)
			if !slices.Equal(portalTenants, wantTenants) {
				t.Errorf(
					"portal regions = %v, want config tenants %v",
					portalTenants, wantTenants,
				)
			}

			hubTenants := make([]string, 0, len(hub.Regions))
			for _, got := range hub.Regions {
				hubTenants = append(hubTenants, got.TenantID)
				cfg, ok := configs[got.TenantID]
				if !ok {
					continue
				}
				wantPlans := make([]string, len(cfg.HubAPIServer.OfferedPlans))
				for i, plan := range cfg.HubAPIServer.OfferedPlans {
					wantPlans[i] = string(plan)
				}
				if !slices.Equal(got.HubPlans, wantPlans) {
					t.Errorf(
						"hub region %q hubPlans = %v, want offeredPlans %v",
						got.TenantID, got.HubPlans, wantPlans,
					)
				}
				if got.MediaOrigin != cfg.ObjectStorage.MediaBaseURL {
					t.Errorf(
						"hub region %q mediaOrigin = %q, want mediaBaseURL %q",
						got.TenantID, got.MediaOrigin,
						cfg.ObjectStorage.MediaBaseURL,
					)
				}
			}
			orgTenants := make([]string, 0, len(org.Regions))
			for _, got := range org.Regions {
				orgTenants = append(orgTenants, got.TenantID)
				cfg, ok := configs[got.TenantID]
				if !ok {
					continue
				}
				wantPlans := make([]string, len(cfg.OrgBilling.OfferedPlans))
				for i, plan := range cfg.OrgBilling.OfferedPlans {
					wantPlans[i] = string(plan)
				}
				if !slices.Equal(got.OrgPlans, wantPlans) {
					t.Errorf(
						"org region %q orgPlans = %v, want offeredPlans %v",
						got.TenantID, got.OrgPlans, wantPlans,
					)
				}
			}
			slices.Sort(orgTenants)
			if !slices.Equal(orgTenants, wantTenants) {
				t.Errorf(
					"org regions = %v, want config tenants %v",
					orgTenants, wantTenants,
				)
			}

			slices.Sort(hubTenants)
			if !slices.Equal(hubTenants, wantTenants) {
				t.Errorf(
					"hub regions = %v, want config tenants %v",
					hubTenants, wantTenants,
				)
			}
		})
	}
}

// tenantConfigs loads every tenant config matched by glob, keyed by tenant.
// The coordinator and catalog files share the directories but are not
// tenant configs.
func tenantConfigs(t *testing.T, glob string) map[string]Config {
	t.Helper()
	paths, err := filepath.Glob(glob)
	if err != nil {
		t.Fatal(err)
	}
	configs := make(map[string]Config)
	for _, path := range paths {
		switch {
		case filepath.Base(path) == "global-coordinator.json",
			filepath.Base(path) == "signup-regions.json",
			filepath.Base(filepath.Dir(path)) == "global-coordinator":
			continue
		}
		cfg, err := LoadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := configs[cfg.TenantID]; ok {
			t.Fatalf("%s: duplicate tenant %q", path, cfg.TenantID)
		}
		configs[cfg.TenantID] = cfg
	}
	if len(configs) == 0 {
		t.Fatalf("%s matched no tenant configs", glob)
	}
	return configs
}

func decodeStrict(t *testing.T, path string, value any) {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
}

func countryStrings[T ~string](values []T) []string {
	out := make([]string, len(values))
	for i, value := range values {
		out[i] = string(value)
	}
	return out
}

func isAPIOrigin(value string, requireHTTPS bool) bool {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil ||
		value != u.Scheme+"://"+u.Host {
		return false
	}
	if requireHTTPS {
		return u.Scheme == "https"
	}
	return u.Scheme == "https" || u.Scheme == "http"
}

var traefikHost = regexp.MustCompile("Host\\(`([^`]+)`\\)")

// checkRegionalIngress ties a region's table entry to the ingress that serves
// it: the API routers answer exactly the table's API host, and each CORS
// policy allows exactly the portal origin the region's emailed links use. A
// swapped or mistyped origin would otherwise send a portal's credentials to
// the wrong region, and only the environment's own table would notice.
func checkRegionalIngress(
	t *testing.T, path, apiOrigin string, cfg Config,
) {
	t.Helper()
	var ingress struct {
		HTTP struct {
			Routers map[string]struct {
				Rule        string   `json:"rule"`
				Middlewares []string `json:"middlewares"`
			} `json:"routers"`
			Middlewares map[string]struct {
				Headers struct {
					AllowOrigins []string `json:"accessControlAllowOriginList"`
				} `json:"headers"`
			} `json:"middlewares"`
		} `json:"http"`
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(contents, &ingress); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	u, err := url.Parse(apiOrigin)
	if err != nil {
		t.Fatal(err)
	}
	for _, api := range []struct{ router, portal string }{
		{"api-hub", cfg.HubAPIServer.PublicBaseURL},
		{"api-orgs", cfg.OrgsAPIServer.PublicBaseURL},
	} {
		router, ok := ingress.HTTP.Routers[api.router]
		if !ok {
			t.Errorf("%s: router %q missing", path, api.router)
			continue
		}
		match := traefikHost.FindStringSubmatch(router.Rule)
		if match == nil || match[1] != u.Host {
			t.Errorf(
				"%s: router %q rule %q, want host %q (apiOrigin)",
				path, api.router, router.Rule, u.Host,
			)
		}
		if len(router.Middlewares) != 1 {
			t.Errorf(
				"%s: router %q middlewares = %v, want one CORS policy",
				path, api.router, router.Middlewares,
			)
			continue
		}
		origins := ingress.HTTP.Middlewares[router.Middlewares[0]].Headers.AllowOrigins
		if !slices.Equal(origins, []string{api.portal}) {
			t.Errorf(
				"%s: router %q allows origins %v, want [%s] (publicBaseURL)",
				path, api.router, origins, api.portal,
			)
		}
	}
}
