package email

import (
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
)

func TestRendererLoadsEveryLocalizedTemplate(t *testing.T) {
	renderer, err := NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	data := TemplateData{
		DisplayName: "Ada & Lin",
		ActionURL:   "https://hub.example/verify?one=1&two=2",
		ExpiresAt:   time.Date(2026, 8, 24, 12, 30, 0, 0, time.UTC),
		Code:        "123456",
		LeadDays:    7,
	}
	for _, locale := range hub.FrontendLocales() {
		for _, kind := range hubKinds {
			message, renderErr := renderer.Render(kind, string(locale), data)
			if renderErr != nil {
				t.Fatalf("render %s/%s: %v", locale, kind, renderErr)
			}
			if message.Subject == "" || message.TextBody == "" ||
				message.HTMLBody == "" {
				t.Errorf("render %s/%s returned an empty part", locale, kind)
			}
			if strings.Contains(message.HTMLBody, "Ada & Lin") {
				t.Errorf("render %s/%s did not HTML-escape display name", locale, kind)
			}
			if !strings.Contains(message.HTMLBody, "Ada &amp; Lin") &&
				kind == Signup {
				t.Errorf("render %s/%s omitted escaped display name", locale, kind)
			}
			if (kind == ProfessionalEmailVerification ||
				kind == EmailChangeVerification) &&
				(!strings.Contains(message.TextBody, data.Code) ||
					!strings.Contains(message.HTMLBody, data.Code)) {
				t.Errorf("render %s/%s omitted verification code", locale, kind)
			}
			if kind == SubscriptionEnding &&
				(!strings.Contains(message.TextBody, "7") ||
					!strings.Contains(message.HTMLBody, "7")) {
				t.Errorf("render %s/%s omitted the lead time", locale, kind)
			}
		}
	}
}

func TestRendererRejectsUnsupportedLocaleAndKind(t *testing.T) {
	renderer, err := NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := renderer.Render(Signup, "fr", TemplateData{}); err == nil {
		t.Fatal("unsupported locale was accepted")
	}
	if _, err := renderer.Render(Kind("unknown"), string(hub.EnglishUnitedStates), TemplateData{}); err == nil {
		t.Fatal("unsupported kind was accepted")
	}
}

func TestOrgRendererLoadsEveryLocalizedTemplate(t *testing.T) {
	renderer, err := NewOrgRenderer()
	if err != nil {
		t.Fatal(err)
	}
	data := TemplateData{
		ActionURL:    "https://orgs.example/complete-signup?token=a&b=c",
		ExpiresAt:    time.Date(2026, 8, 24, 12, 30, 0, 0, time.UTC),
		ReleaseAfter: time.Date(2026, 9, 24, 12, 30, 0, 0, time.UTC),
		Domain:       "example.com",
		RecordName:   "_vetchium.example.com",
		RecordValue:  "vetchium-verify=<token>",
	}
	for _, locale := range orgs.FrontendLocales() {
		for _, kind := range orgKinds {
			message, err := renderer.Render(kind, string(locale), data)
			if err != nil {
				t.Fatalf("render %s/%s: %v", locale, kind, err)
			}
			if !strings.Contains(message.Subject+message.TextBody, data.Domain) {
				t.Errorf("render %s/%s omitted the domain", locale, kind)
			}
			record := kind == OrgSignupDNSInstructions ||
				kind == OrgDomainFailing || kind == OrgSuspended
			if record != strings.Contains(message.TextBody, data.RecordValue) {
				t.Errorf("render %s/%s record presence = %t", locale, kind, !record)
			}
			if strings.Contains(message.HTMLBody, "<token>") {
				t.Errorf("render %s/%s did not HTML-escape the record", locale, kind)
			}
			link := kind == OrgSignupLink || kind == OrgPasswordReset ||
				kind == OrgInvitation
			if link != strings.Contains(message.TextBody, data.ActionURL) {
				t.Errorf("render %s/%s link presence = %t", locale, kind, !link)
			}
		}
	}
	// The DNS instructions are meant to be forwarded, so they must never
	// carry the private signup link.
	for _, locale := range orgs.FrontendLocales() {
		message, err := renderer.Render(
			OrgSignupDNSInstructions, string(locale), data,
		)
		if err != nil || strings.Contains(message.TextBody+message.HTMLBody, "complete-signup") {
			t.Fatalf("forwardable instructions leak the signup link: %v", err)
		}
	}
	hubRenderer, err := NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := hubRenderer.Render(OrgSignupLink, "en-US", data); err == nil {
		t.Fatal("the Hub renderer rendered an Org kind")
	}
}
