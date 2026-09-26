// Package email renders and sends localized transactional email.
package email

import (
	"bytes"
	"embed"
	"fmt"
	htmltemplate "html/template"
	"io/fs"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/vetchium/src/typespec/hub"
	"github.com/vetchium/src/typespec/orgs"
)

type Kind string

const (
	Signup                        Kind = "signup"
	PasswordReset                 Kind = "password-reset"
	ProfessionalEmailVerification Kind = "professional-email-verification"
	SubscriptionEnding            Kind = "subscription-ending"
	EmailChangeVerification       Kind = "email-change-verification"
	EmailChanged                  Kind = "email-changed"

	OrgSignupDNSInstructions Kind = "org-signup-dns-instructions"
	OrgSignupLink            Kind = "org-signup-link"
	OrgPasswordReset         Kind = "org-password-reset"
	OrgDomainFailing         Kind = "org-domain-failing"
	OrgSuspended             Kind = "org-suspended"
)

var hubKinds = []Kind{
	Signup, PasswordReset, ProfessionalEmailVerification, SubscriptionEnding,
	EmailChangeVerification, EmailChanged,
}

var orgKinds = []Kind{
	OrgSignupDNSInstructions, OrgSignupLink, OrgPasswordReset,
	OrgDomainFailing, OrgSuspended,
}

//go:embed templates/*/*
var templateFiles embed.FS

type TemplateData struct {
	DisplayName string
	ActionURL   string
	ExpiresAt   time.Time
	Code        string
	// LeadDays is the number of days a subscription-ending warning is ahead
	// of the period end: 7 or 1. Unused by every other kind.
	LeadDays int

	// Org domain verification: the domain and the TXT record that proves it,
	// and when a failing domain will be released.
	Domain       string
	RecordName   string
	RecordValue  string
	ReleaseAfter time.Time
}

type Message struct {
	To        string
	Subject   string
	TextBody  string
	HTMLBody  string
	MessageID string
}

type templateSet struct {
	subject *texttemplate.Template
	text    *texttemplate.Template
	html    *htmltemplate.Template
}

// Renderer renders one portal's kinds in that portal's locales. Each portal
// owns its locale set, so equal sets today are not shared policy.
type Renderer struct {
	templates map[string]map[Kind]templateSet
}

func NewRenderer() (*Renderer, error) {
	locales := []string{}
	for _, locale := range hub.FrontendLocales() {
		locales = append(locales, string(locale))
	}
	return newRenderer(locales, hubKinds)
}

func NewOrgRenderer() (*Renderer, error) {
	locales := []string{}
	for _, locale := range orgs.FrontendLocales() {
		locales = append(locales, string(locale))
	}
	return newRenderer(locales, orgKinds)
}

func newRenderer(locales []string, kinds []Kind) (*Renderer, error) {
	renderer := &Renderer{
		templates: make(map[string]map[Kind]templateSet),
	}
	for _, locale := range locales {
		renderer.templates[locale] = make(map[Kind]templateSet)
		for _, kind := range kinds {
			set, err := parseTemplateSet(templateFiles, locale, kind)
			if err != nil {
				return nil, err
			}
			renderer.templates[locale][kind] = set
		}
	}
	return renderer, nil
}

func (r *Renderer) Render(
	kind Kind, locale string, data TemplateData,
) (Message, error) {
	kinds, ok := r.templates[locale]
	if !ok {
		return Message{}, fmt.Errorf("unsupported email locale %q", locale)
	}
	set, ok := kinds[kind]
	if !ok {
		return Message{}, fmt.Errorf("unsupported email kind %q", kind)
	}
	var subject bytes.Buffer
	if err := set.subject.Execute(&subject, data); err != nil {
		return Message{}, fmt.Errorf("render %s %s subject: %w", locale, kind, err)
	}
	var textBody bytes.Buffer
	if err := set.text.Execute(&textBody, data); err != nil {
		return Message{}, fmt.Errorf("render %s %s text: %w", locale, kind, err)
	}
	var htmlBody bytes.Buffer
	if err := set.html.Execute(&htmlBody, data); err != nil {
		return Message{}, fmt.Errorf("render %s %s HTML: %w", locale, kind, err)
	}
	return Message{
		Subject:  strings.TrimSpace(subject.String()),
		TextBody: strings.TrimSpace(textBody.String()) + "\n",
		HTMLBody: strings.TrimSpace(htmlBody.String()) + "\n",
	}, nil
}

func parseTemplateSet(
	files fs.FS, locale string, kind Kind,
) (templateSet, error) {
	directory := "templates/" + locale + "/" + string(kind)
	subjectSource, err := fs.ReadFile(files, directory+".subject.txt")
	if err != nil {
		return templateSet{}, fmt.Errorf("read %s subject: %w", directory, err)
	}
	subject, err := texttemplate.New("subject").Option("missingkey=error").
		Parse(string(subjectSource))
	if err != nil {
		return templateSet{}, fmt.Errorf("parse %s subject: %w", directory, err)
	}
	textSource, err := fs.ReadFile(files, directory+".body.txt")
	if err != nil {
		return templateSet{}, fmt.Errorf("read %s text: %w", directory, err)
	}
	textBody, err := texttemplate.New("text").Option("missingkey=error").
		Parse(string(textSource))
	if err != nil {
		return templateSet{}, fmt.Errorf("parse %s text: %w", directory, err)
	}
	htmlSource, err := fs.ReadFile(files, directory+".body.html")
	if err != nil {
		return templateSet{}, fmt.Errorf("read %s HTML: %w", directory, err)
	}
	htmlBody, err := htmltemplate.New("html").Option("missingkey=error").
		Parse(string(htmlSource))
	if err != nil {
		return templateSet{}, fmt.Errorf("parse %s HTML: %w", directory, err)
	}
	return templateSet{subject: subject, text: textBody, html: htmlBody}, nil
}
