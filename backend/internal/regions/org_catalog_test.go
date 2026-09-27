package regions

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/vetchium/src/typespec/common"
	regionspec "github.com/vetchium/src/typespec/regions"
)

func TestOrgCatalogKeysetAndEligibility(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 54)
	// Hub residency restrictions and the Hub switch must not affect Orgs.
	c.Regions[0].AllowedCountries = []common.CountryCode{"DE"}
	c.Regions[1].SignupEnabled = false
	c.Regions[2].OrgSignupEnabled = false

	request := regionspec.ListOrgSignupRegionsRequest{Country: "IN"}
	first, err := c.ListOrgs(request)
	if err != nil {
		t.Fatal(err)
	}
	if first.CatalogVersion != "1" || len(first.Regions) != 50 ||
		first.NextPaginationKey == nil {
		t.Fatalf("unexpected first page: %+v", first)
	}
	if first.Regions[0].TenantID != "region000" ||
		first.Regions[0].OrgsURL != "https://orgs.region000.example.com" ||
		first.Regions[0].HostingCountry != "SG" ||
		first.Regions[1].TenantID != "region001" ||
		!first.Regions[1].Recommended {
		t.Fatalf("unexpected first regions: %+v", first.Regions[:2])
	}
	for _, region := range first.Regions {
		if region.TenantID == "region002" {
			t.Fatal("region with Org signup disabled was listed")
		}
		if region.Recommended != (region.TenantID == "region001") {
			t.Fatalf("unexpected recommendation: %+v", region)
		}
	}

	request.PaginationKey = first.NextPaginationKey
	second, err := c.ListOrgs(request)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Regions) != 3 || second.NextPaginationKey != nil ||
		second.Regions[0].TenantID <= first.Regions[49].TenantID {
		t.Fatalf("unexpected second page: %+v", second)
	}

	request.Country = "DE"
	if _, err := c.ListOrgs(request); err == nil ||
		errors.Is(err, ErrForeignCursor) {
		t.Fatalf("cross-country cursor error = %v, want invalid key", err)
	}
	request.Country = "IN"
	c.fingerprint = "changed"
	if _, err := c.ListOrgs(request); !errors.Is(err, ErrForeignCursor) {
		t.Fatalf("old-catalog cursor error = %v, want ErrForeignCursor", err)
	}
}

func TestOrgAndHubCursorsAreNotInterchangeable(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 51)
	hub, err := c.List(regionspec.ListSignupRegionsRequest{
		ResidentCountry: "IN",
	})
	if err != nil || hub.NextPaginationKey == nil {
		t.Fatalf("Hub page = %+v, %v", hub, err)
	}
	orgs, err := c.ListOrgs(regionspec.ListOrgSignupRegionsRequest{
		Country: "IN",
	})
	if err != nil || orgs.NextPaginationKey == nil {
		t.Fatalf("Org page = %+v, %v", orgs, err)
	}

	if _, err := c.ListOrgs(regionspec.ListOrgSignupRegionsRequest{
		Country: "IN", PaginationKey: hub.NextPaginationKey,
	}); err == nil || errors.Is(err, ErrForeignCursor) {
		t.Fatalf("Hub cursor on Org list error = %v, want invalid key", err)
	}
	if _, err := c.List(regionspec.ListSignupRegionsRequest{
		ResidentCountry: "IN", PaginationKey: orgs.NextPaginationKey,
	}); err == nil || errors.Is(err, ErrForeignCursor) {
		t.Fatalf("Org cursor on Hub list error = %v, want invalid key", err)
	}

	// Hub cursors cross the mesh to and from the coordinator, so their
	// encoding must not change.
	raw, err := base64.RawURLEncoding.DecodeString(
		string(*hub.NextPaginationKey),
	)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if _, ok := fields["list"]; ok || len(fields) != 3 {
		t.Fatalf("Hub cursor fields = %v, want country, version, last", fields)
	}
}

func TestOrgRecommendationFallsBack(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name     string
		country  common.CountryCode
		change   func(*Catalog)
		want     string
		wantNone bool
	}{
		{name: "country recommendation", country: "IN", want: "region001"},
		{name: "default tenant", country: "FR", want: "region000"},
		{
			name: "recommendation ignores Hub residency", country: "IN",
			change: func(c *Catalog) {
				c.Regions[1].AllowedCountries = []common.CountryCode{"DE"}
				c.Regions[1].SignupEnabled = false
			},
			want: "region001",
		},
		{
			name: "first Org-enabled region", country: "IN",
			change: func(c *Catalog) {
				c.Regions[0].OrgSignupEnabled = false
				c.Regions[1].OrgSignupEnabled = false
			},
			want: "region002",
		},
		{
			name: "no Org-enabled region", country: "IN",
			change: func(c *Catalog) {
				for i := range c.Regions {
					c.Regions[i].OrgSignupEnabled = false
				}
			},
			wantNone: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			c := testCatalog(t, 3)
			if test.change != nil {
				test.change(c)
			}
			response, err := c.ListOrgs(regionspec.ListOrgSignupRegionsRequest{
				Country: test.country,
			})
			if err != nil {
				t.Fatal(err)
			}
			if test.wantNone {
				if len(response.Regions) != 0 ||
					response.NextPaginationKey != nil {
					t.Fatalf("response = %+v, want no regions", response)
				}
				return
			}
			recommended := []string{}
			for _, region := range response.Regions {
				if region.Recommended {
					recommended = append(recommended, region.TenantID)
				}
			}
			if len(recommended) != 1 || recommended[0] != test.want {
				t.Fatalf("recommended = %v, want [%s]", recommended, test.want)
			}
		})
	}
}

func TestOrgCatalogLookups(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 2)
	c.Regions[1].OrgSignupEnabled = false
	c.Regions[1].AllowedCountries = []common.CountryCode{"DE"}

	if !c.OrgSignupEnabled("region000") || c.OrgSignupEnabled("region001") ||
		c.OrgSignupEnabled("unknown") {
		t.Fatal("OrgSignupEnabled does not follow the catalog flag")
	}
	if !c.HasOrgsOrigin("region000", "https://orgs.region000.example.com") ||
		c.HasOrgsOrigin("region000", "https://orgs.region001.example.com") ||
		c.HasOrgsOrigin("region000", "https://region000.example.com") ||
		c.HasOrgsOrigin("unknown", "https://orgs.region000.example.com") {
		t.Fatal("HasOrgsOrigin matched the wrong origin")
	}
	if origin, ok := c.OrgsURL("region001"); !ok ||
		origin != "https://orgs.region001.example.com" {
		t.Fatalf("OrgsURL(region001) = %q, %v", origin, ok)
	}
	if origin, ok := c.OrgsURL("unknown"); ok || origin != "" {
		t.Fatalf("OrgsURL(unknown) = %q, %v", origin, ok)
	}
}

func TestValidateRequiresOrgsURL(t *testing.T) {
	t.Parallel()
	c := testCatalog(t, 2)
	c.Regions[0].OrgsURL = ""
	if err := c.Validate(); err == nil ||
		!strings.Contains(err.Error(), "Org portal origin") {
		t.Fatalf("Validate() error = %v, want Org origin error", err)
	}
}
