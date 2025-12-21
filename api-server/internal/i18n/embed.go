package i18n

import "embed"

//go:embed translations/*/*.json translations/*/*/*.json
var translationFiles embed.FS
