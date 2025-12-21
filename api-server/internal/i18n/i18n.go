package i18n

import (
	"encoding/json"
	"io/fs"
	"log"
	"strings"
	"sync"
	"text/template"

	"golang.org/x/text/language"
)

// DefaultLanguage is the fallback language when no match is found
const DefaultLanguage = "en-US"

// catalog holds all translations: lang -> namespace -> key -> value
var (
	catalog        = make(map[string]map[string]map[string]string)
	catalogOnce    sync.Once
	matcher        language.Matcher
	supportedCodes []string // Stores language codes in matcher order for index lookup
)

func init() {
	loadCatalog()
}

func loadCatalog() {
	catalogOnce.Do(func() {
		entries, err := fs.ReadDir(translationFiles, "translations")
		if err != nil {
			log.Printf("i18n: failed to read translations dir: %v", err)
			return
		}

		var supportedTags []language.Tag
		var langCodes []string

		for _, langDir := range entries {
			if !langDir.IsDir() {
				continue
			}
			lang := langDir.Name()
			catalog[lang] = make(map[string]map[string]string)

			loadLanguageDir(lang, "translations/"+lang)

			// Parse as BCP 47 tag for the matcher
			tag, err := language.Parse(lang)
			if err != nil {
				log.Printf("i18n: invalid language tag %q: %v", lang, err)
				continue
			}
			supportedTags = append(supportedTags, tag)
			langCodes = append(langCodes, lang)
		}

		// Create matcher with default language first
		// The matcher returns an index into this combined slice
		defaultTag := language.MustParse(DefaultLanguage)
		allTags := append([]language.Tag{defaultTag}, supportedTags...)
		matcher = language.NewMatcher(allTags)

		// Build supportedCodes in the same order as allTags
		supportedCodes = append([]string{DefaultLanguage}, langCodes...)
	})
}

func loadLanguageDir(lang, path string) {
	entries, err := fs.ReadDir(translationFiles, path)
	if err != nil {
		log.Printf("i18n: failed to read dir %s: %v", path, err)
		return
	}

	for _, entry := range entries {
		fullPath := path + "/" + entry.Name()
		if entry.IsDir() {
			loadLanguageDir(lang, fullPath)
		} else if strings.HasSuffix(entry.Name(), ".json") {
			loadJSONFile(lang, fullPath)
		}
	}
}

func loadJSONFile(lang, path string) {
	data, err := fs.ReadFile(translationFiles, path)
	if err != nil {
		log.Printf("i18n: failed to read %s: %v", path, err)
		return
	}

	var messages map[string]string
	if err := json.Unmarshal(data, &messages); err != nil {
		log.Printf("i18n: failed to parse %s: %v", path, err)
		return
	}

	// Use relative path as namespace: "emails/admin_tfa"
	relPath := strings.TrimPrefix(path, "translations/"+lang+"/")
	namespace := strings.TrimSuffix(relPath, ".json")

	// Filter out metadata keys (starting with _)
	filtered := make(map[string]string)
	for k, v := range messages {
		if !strings.HasPrefix(k, "_") {
			filtered[k] = v
		}
	}

	catalog[lang][namespace] = filtered
}

// Match finds the best supported language for the given user preference.
// Returns the matched language code (e.g., "en-US", "de-DE").
// Falls back to DefaultLanguage if no good match is found.
func Match(userPref string) string {
	if userPref == "" {
		return DefaultLanguage
	}

	tag, err := language.Parse(userPref)
	if err != nil {
		return DefaultLanguage
	}

	// Use the index to get the original language code string
	// The matcher returns the index into supportedCodes
	_, index, _ := matcher.Match(tag)
	if index >= 0 && index < len(supportedCodes) {
		return supportedCodes[index]
	}

	return DefaultLanguage
}

// T returns a translated string for the given language, namespace, and key.
// Falls back to English if the translation is not found.
func T(lang, namespace, key string) string {
	// Try requested language
	if ns, ok := catalog[lang]; ok {
		if msgs, ok := ns[namespace]; ok {
			if msg, ok := msgs[key]; ok {
				return msg
			}
		}
	}

	// Fallback to default language
	if lang != DefaultLanguage {
		if ns, ok := catalog[DefaultLanguage]; ok {
			if msgs, ok := ns[namespace]; ok {
				if msg, ok := msgs[key]; ok {
					return msg
				}
			}
		}
	}

	// Return key if nothing found (helps identify missing translations)
	return key
}

// TF returns a translated string with template interpolation.
// Uses Go's text/template syntax: {{.FieldName}}
func TF(lang, namespace, key string, data any) string {
	msg := T(lang, namespace, key)

	tmpl, err := template.New("").Parse(msg)
	if err != nil {
		return msg
	}

	var buf strings.Builder
	if err := tmpl.Execute(&buf, data); err != nil {
		return msg
	}
	return buf.String()
}

// SupportedLanguages returns all loaded language codes
func SupportedLanguages() []string {
	langs := make([]string, 0, len(catalog))
	for lang := range catalog {
		langs = append(langs, lang)
	}
	return langs
}

// HasTranslation checks if a translation exists for the given language, namespace, and key
func HasTranslation(lang, namespace, key string) bool {
	if ns, ok := catalog[lang]; ok {
		if msgs, ok := ns[namespace]; ok {
			_, exists := msgs[key]
			return exists
		}
	}
	return false
}
