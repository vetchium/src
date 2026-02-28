package admin

import (
	"fmt"
	"time"

	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.typespec/admin"
)

const tagIconURLBase = "/public/tag-icon"

func buildAdminTagResponse(tag globaldb.Tag, translations []globaldb.GetTagTranslationsRow) admin.AdminTag {
	resp := admin.AdminTag{
		TagID:        tag.TagID,
		Translations: make([]admin.TagTranslation, 0, len(translations)),
		CreatedAt:    tag.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:    tag.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}

	for _, t := range translations {
		tr := admin.TagTranslation{
			Locale:      t.Locale,
			DisplayName: t.DisplayName,
		}
		if t.Description.Valid {
			desc := t.Description.String
			tr.Description = &desc
		}
		resp.Translations = append(resp.Translations, tr)
	}

	if tag.SmallIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=small", tagIconURLBase, tag.TagID)
		resp.SmallIconURL = &url
	}
	if tag.LargeIconKey.Valid {
		url := fmt.Sprintf("%s?tag_id=%s&size=large", tagIconURLBase, tag.TagID)
		resp.LargeIconURL = &url
	}

	return resp
}
