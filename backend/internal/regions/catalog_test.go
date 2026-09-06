package regions

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/vetchium/src/typespec/common"
	regionspec "github.com/vetchium/src/typespec/regions"
)

func testCatalog(t *testing.T, count int) *Catalog {
	t.Helper()
	c := Catalog{Version: "1", DefaultTenant: "region000", Recommendations: map[common.CountryCode]string{"IND": "region001"}}
	for i := 0; i < count; i++ {
		c.Regions = append(c.Regions, Region{TenantID: fmt.Sprintf("region%03d", i), HostingCountry: "SGP", HubURL: fmt.Sprintf("https://region%03d.example.com", i), SignupEnabled: true})
	}
	return loadTestCatalog(t, c)
}
func loadTestCatalog(t *testing.T, c Catalog) *Catalog {
	t.Helper()
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "regions.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	result, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestCatalogKeysetAndEligibility(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 53)
	c.Regions[0].AllowedCountries = []common.CountryCode{"DEU"}
	c.Regions[2].SignupEnabled = false
	if c.Allows("region000", "IND") || c.Allows("region002", "IND") || c.Allows("unknown", "IND") {
		t.Fatal("ineligible region allowed")
	}
	request := regionspec.ListSignupRegionsRequest{ResidentCountry: "IND"}
	first, err := c.List(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Regions) != 50 || first.NextPaginationKey == nil || !first.Regions[0].Recommended {
		t.Fatalf("unexpected first page: %+v", first)
	}
	request.PaginationKey = first.NextPaginationKey
	second, err := c.List(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Regions) != 1 || second.NextPaginationKey != nil || second.Regions[0].TenantID <= first.Regions[49].TenantID {
		t.Fatalf("unexpected second page: %+v", second)
	}
	request.ResidentCountry = "DEU"
	if _, err := c.List(request); err == nil {
		t.Fatal("cross-country cursor accepted")
	}
	request.ResidentCountry = "IND"
	c.fingerprint = "changed"
	if _, err := c.List(request); err == nil {
		t.Fatal("old-catalog cursor accepted")
	}
}
func TestCatalogValidation(t *testing.T) {
	t.Parallel()
	for _, change := range []func(*Catalog){
		func(c *Catalog) { c.Version = "" },
		func(c *Catalog) { c.DefaultTenant = "missing" },
		func(c *Catalog) { c.Regions[0].HubURL = "https://trusted.example@evil.example" },
		func(c *Catalog) { c.Regions[0].HubURL = "javascript:alert(1)" },
		func(c *Catalog) { c.Regions[0].HubURL = "https://example.com/path" },
		func(c *Catalog) { c.Regions[0].HubURL = "https://example.com?" },
		func(c *Catalog) { c.Regions[0].AllowedCountries = []common.CountryCode{"ZZZ"} },
		func(c *Catalog) { c.Regions[0].AllowedCountries = []common.CountryCode{"IND", "IND"} },
		func(c *Catalog) { c.Regions[1].TenantID = c.Regions[0].TenantID },
		func(c *Catalog) { c.Regions[1].HubURL = c.Regions[0].HubURL },
		func(c *Catalog) { c.Recommendations["ZZZ"] = "region000" },
	} {
		c := testCatalog(t, 2)
		change(c)
		if c.Validate() == nil {
			t.Fatal("invalid catalog accepted")
		}
	}
}

// SignupEnabled must ignore country restrictions: hub-api compares it against
// a local setting that knows nothing about the visitor's residence.
func TestCatalogSignupEnabledIgnoresCountryRestrictions(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 3)
	c.Regions[0].AllowedCountries = []common.CountryCode{"DEU"}
	c.Regions[1].SignupEnabled = false
	for _, tt := range []struct {
		tenant string
		want   bool
	}{
		{"region000", true},
		{"region001", false},
		{"region002", true},
		{"unknown", false},
	} {
		if got := c.SignupEnabled(tt.tenant); got != tt.want {
			t.Errorf("SignupEnabled(%q) = %v, want %v", tt.tenant, got, tt.want)
		}
	}
	if c.Allows("region000", "IND") {
		t.Fatal("country restriction ignored by Allows")
	}
}
