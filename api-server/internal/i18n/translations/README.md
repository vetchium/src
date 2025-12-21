# Vetchium Translations

This directory contains all user-facing text translations for Vetchium.

## Directory Structure

```
translations/
├── en-US/              # English (United States) - DEFAULT/REFERENCE
│   ├── emails/         # Email templates
│   │   └── admin_tfa.json
│   └── common.json     # Shared strings
├── de-DE/              # German (Germany)
│   ├── emails/
│   │   └── admin_tfa.json
│   └── common.json
└── ta-IN/              # Tamil (India)
    ├── emails/
    │   └── admin_tfa.json
    └── common.json
```

Each language folder must mirror the `en-US` structure exactly.

## Language Codes (BCP 47)

We use BCP 47 language tags in the format: `language-REGION`

| Folder | Language | Region |
|--------|----------|--------|
| `en-US` | English | United States |
| `de-DE` | German | Germany |
| `ta-IN` | Tamil | India |

### Finding Language Codes

Look up codes at: https://www.iana.org/assignments/language-subtag-registry

Common examples:
- `en-GB` - English (United Kingdom)
- `en-IN` - English (India)
- `fr-FR` - French (France)
- `fr-CA` - French (Canada)
- `es-ES` - Spanish (Spain)
- `es-MX` - Spanish (Mexico)
- `hi-IN` - Hindi (India)
- `ja-JP` - Japanese (Japan)
- `zh-CN` - Chinese (Simplified, China)
- `zh-TW` - Chinese (Traditional, Taiwan)

## For Translators

### Translating an Existing Language

1. Navigate to your language folder (e.g., `de-DE/`)
2. Open the JSON file you want to translate
3. Translate ONLY the text values (right side of the colon)

### What NOT to Change

- **Keys** (left side of the colon) - must stay in English
- **Placeholders** like `{{.Code}}` or `{{.Minutes}}` - keep exactly as-is
- **Metadata keys** starting with `_` (like `_description`) - optional to translate

### Example

**English (`en-US/emails/admin_tfa.json`):**
```json
{
  "_description": "Admin Two-Factor Authentication Email",
  "subject": "Your Verification Code",
  "body_expiry": "This code will expire in {{.Minutes}} minutes."
}
```

**German translation (`de-DE/emails/admin_tfa.json`):**
```json
{
  "_description": "Admin Two-Factor Authentication Email",
  "subject": "Ihr Bestaetigungscode",
  "body_expiry": "Dieser Code laeuft in {{.Minutes}} Minuten ab."
}
```

Notice:
- `"subject"` key stays the same, only the value changes
- `{{.Minutes}}` placeholder stays exactly the same
- `_description` can stay in English (it's just a comment)

### Adding a New Language

1. Create a new folder with the BCP 47 language code:
   ```
   mkdir fr-FR
   mkdir fr-FR/emails
   ```

2. Copy all files from `en-US/` to your new folder:
   ```
   cp en-US/common.json fr-FR/
   cp en-US/emails/*.json fr-FR/emails/
   ```

3. Translate all values in each file

4. Submit your translations (pull request or send to development team)

### Validating Your JSON

Before submitting, validate your JSON files to catch syntax errors:

**Option 1: Online validator**
1. Go to https://jsonlint.com/
2. Paste your file content
3. Click "Validate JSON"
4. Fix any errors shown

**Option 2: Command line (if available)**
```bash
python -m json.tool your_file.json
```

### Common JSON Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| `"key": "value"` (no comma) | Missing comma after line | Add `,` after each line except the last |
| `"key": "value",` (last line) | Extra comma on last item | Remove the trailing comma |
| `"key": 'value'` | Single quotes | Use double quotes `"` only |
| `"key": "It's here"` | Unescaped quote | Use `\"` for quotes inside strings |
| Missing `"` | Unclosed string | Ensure all strings have opening and closing `"` |

### Placeholder Reference

Placeholders are variables that get replaced with actual values. Keep them exactly as shown.

| Placeholder | Description | Example Output |
|-------------|-------------|----------------|
| `{{.Code}}` | Verification code | `123456` |
| `{{.Minutes}}` | Time duration in minutes | `10` |
| `{{.Email}}` | Email address | `user@example.com` |
| `{{.Name}}` | Person's name | `John` |
| `{{.CompanyName}}` | Company name | `Acme Inc` |
| `{{.URL}}` | Web link | `https://vetchium.com/...` |

### File Descriptions

| File | Purpose |
|------|---------|
| `common.json` | Shared strings used across multiple templates |
| `emails/admin_tfa.json` | Admin login verification code email |

## For Developers

### Adding New Strings

1. Add the string to `en-US/` first (this is the reference)
2. Add the same key to all other language files
3. Request translations for non-English languages

### Using Translations in Code

```go
import "vetchium-api-server.gomodule/internal/i18n"

// Simple translation
subject := i18n.T(userLang, "emails/admin_tfa", "subject")

// Translation with placeholders
data := struct{ Minutes int }{Minutes: 10}
body := i18n.TF(userLang, "emails/admin_tfa", "body_expiry", data)

// Language matching (finds best available)
matchedLang := i18n.Match("en-IN")  // Returns "en-US" if en-IN not available
```

### Namespace Convention

Namespaces are derived from file paths relative to the language folder:

| File Path | Namespace |
|-----------|-----------|
| `en-US/common.json` | `common` |
| `en-US/emails/admin_tfa.json` | `emails/admin_tfa` |
| `en-US/emails/password_reset.json` | `emails/password_reset` |

## Questions?

Contact the development team or open an issue on GitHub.
