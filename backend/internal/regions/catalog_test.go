package regions

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/vetchium/src/typespec/common"
)

func testCatalog(t *testing.T, count int) *Catalog {
	t.Helper()
	c := Catalog{DefaultTenant: "region000", Recommendations: map[common.CountryCode]string{"IN": "region001"}}
	for i := 0; i < count; i++ {
		c.Regions = append(c.Regions, Region{
			TenantID:         fmt.Sprintf("region%03d", i),
			HostingCountry:   "SG",
			SignupEnabled:    true,
			OrgSignupEnabled: true,
		})
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
func TestCatalogValidation(t *testing.T) {
	t.Parallel()
	for _, change := range []func(*Catalog){
		func(c *Catalog) { c.Regions = nil },
		func(c *Catalog) { c.DefaultTenant = "missing" },
		func(c *Catalog) { c.Regions[0].TenantID = "Region000" },
		func(c *Catalog) { c.Regions[0].HostingCountry = "ZZ" },
		func(c *Catalog) { c.Regions[0].AllowedCountries = []common.CountryCode{"ZZ"} },
		func(c *Catalog) { c.Regions[0].AllowedCountries = []common.CountryCode{"IN", "IN"} },
		func(c *Catalog) { c.Regions[1].TenantID = c.Regions[0].TenantID },
		func(c *Catalog) { c.Recommendations["ZZ"] = "region000" },
		func(c *Catalog) { c.Recommendations["DE"] = "missing" },
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
	c.Regions[0].AllowedCountries = []common.CountryCode{"DE"}
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
	if c.Allows("region000", "IN") {
		t.Fatal("country restriction ignored by Allows")
	}
}

func TestCatalogRegionLooksUpOneTenant(t *testing.T) {
	catalog := testCatalog(t, 3)
	region, ok := catalog.Region(catalog.Regions[1].TenantID)
	if !ok || region.TenantID != catalog.Regions[1].TenantID ||
		region.HostingCountry != catalog.Regions[1].HostingCountry {
		t.Fatalf("Region() = %+v, %v", region, ok)
	}
	if _, ok := catalog.Region("absent"); ok {
		t.Fatal("Region() found an absent tenant")
	}
}

func TestOrgSignupEnabledFollowsTheCatalogFlag(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 2)
	c.Regions[1].OrgSignupEnabled = false
	c.Regions[1].AllowedCountries = []common.CountryCode{"DE"}
	if !c.OrgSignupEnabled("region000") || c.OrgSignupEnabled("region001") ||
		c.OrgSignupEnabled("unknown") {
		t.Fatal("OrgSignupEnabled does not follow the catalog flag")
	}
}

// The portal URLs moved into the portals' region tables; a catalog still
// naming one must fail to load rather than silently carry stale hosts.
func TestLoadRejectsPortalURLs(t *testing.T) {
	t.Parallel()
	for _, member := range []string{"hubURL", "orgsURL"} {
		path := filepath.Join(t.TempDir(), "regions.json")
		contents := fmt.Sprintf(`{"defaultTenant":"sgp",
"recommendations":{},"regions":[{"tenantId":"sgp","hostingCountry":"SG",
"signupEnabled":true,"allowedCountries":[],"orgSignupEnabled":true,
%q:"https://sgp.example.com"}]}`, member)
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Fatalf("catalog with %s loaded", member)
		}
	}
}
