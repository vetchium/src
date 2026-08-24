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

	"github.com/vetchium/src/typespec/common"
)

type Kind string

const (
	Signup        Kind = "signup"
	PasswordReset Kind = "password-reset"
)

var supportedKinds = []Kind{Signup, PasswordReset}
var supportedLocales = []common.FrontendLocale{
	common.EnglishUnitedStates,
	common.Tamil,
	common.German,
}

//go:embed templates/*/*
var templateFiles embed.FS

type TemplateData struct {
	DisplayName string
	ActionURL   string
	ExpiresAt   time.Time
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

type Renderer struct {
	templates map[common.FrontendLocale]map[Kind]templateSet
}

func NewRenderer() (*Renderer, error) {
	renderer := &Renderer{
		templates: make(map[common.FrontendLocale]map[Kind]templateSet),
	}
	for _, locale := range supportedLocales {
		renderer.templates[locale] = make(map[Kind]templateSet)
		for _, kind := range supportedKinds {
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
	kind Kind, locale common.FrontendLocale, data TemplateData,
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
	files fs.FS, locale common.FrontendLocale, kind Kind,
) (templateSet, error) {
	directory := "templates/" + string(locale) + "/" + string(kind)
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
