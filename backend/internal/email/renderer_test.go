package email

import (
	"strings"
	"testing"
	"time"

	"github.com/vetchium/src/typespec/common"
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
	}
	for _, locale := range supportedLocales {
		for _, kind := range supportedKinds {
			message, renderErr := renderer.Render(kind, locale, data)
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
		}
	}
}

func TestRendererRejectsUnsupportedLocaleAndKind(t *testing.T) {
	renderer, err := NewRenderer()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := renderer.Render(Signup, common.FrontendLocale("fr"), TemplateData{}); err == nil {
		t.Fatal("unsupported locale was accepted")
	}
	if _, err := renderer.Render(Kind("unknown"), common.EnglishUnitedStates, TemplateData{}); err == nil {
		t.Fatal("unsupported kind was accepted")
	}
}
