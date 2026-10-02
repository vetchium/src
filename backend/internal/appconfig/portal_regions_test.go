package appconfig

import (
	"bytes"
	"encoding/json"
	"maps"
	"net/url"
	"os"
	"path/filepath"
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
	}{
		{
			"dev",
			filepath.Join(root, "config", "*.json"),
			filepath.Join(root, "config", "signup-regions.json"),
		},
		{
			"ci",
			filepath.Join(root, "config", "ci", "*.json"),
			filepath.Join(root, "config", "ci", "signup-regions.json"),
		},
		{
			"production",
			filepath.Join(root, "deploy", "*", "config.json"),
			filepath.Join(root, "deploy", "signup-regions.json"),
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
