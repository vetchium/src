Status: DRAFT
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- A new user role called admin:manage_tags for Vetchium AdminPortal users
- AdminPortal users with either admin:manage_tags role or admin:superadmin should be able to:
  - Use APIs to CRU tags, enforced via middleware on the backend
  - See the tile on the UI to CRU tags on the Admin portal, under a UI route /manage-tags
- AdminPortal users without either of the above roles should not be able to use the APIs or see the tile on the UI homepage or visit the URL

## Scope

A Tag will be a site-wide feature working across portals. In future this will be used in various operations like creating an Opening on the Employer Portal, writing a Post on the HubUsers portal, A Hub User following the posts or jobs with a Tag, etc

A Tag will be having an unique human-readable ID in English. Ex: artificial-intelligence. It should all be in lowercase and contain only English lower case letters and a hyphen. The maximum length of a Tag ID is 64 characters. The Tag ID is immutable once created.

A Tag will have a display name on a per-locale basis. If there is no translation available on a locale, the corresponding English string should be used. For example, en-US could have "Artificial Intelligence" which could map to "செயற்கை நுண்ணறிவு" in ta-IN, but appear as is for de-DE. The maximum length of a display name is 100 characters.

A Tag can optionally have an Icon as an image which an admin user of Vetchium will be able to add. The icons need to be in two sizes, one small (32x32 pixels) for appearing in user's posts, one large (256x256 pixels) for the Tag's page. Accepted formats are PNG, SVG, JPEG, and WebP. Maximum file size is 5 MB per icon. The images for the icons should be uploaded to the S3 compatible bucket that the global server is configured against via a dedicated upload API. All the Tag details are stored on the Global API server and its database.

Icon upload and removal are handled by separate dedicated APIs:

- Upload: `POST /admin/upload-tag-icon` — uploads either the small or large icon for a tag
- Remove: `POST /admin/delete-tag-icon` — removes either the small or large icon from a tag (the tag itself is not deleted)

The description should also be marked for translation and be locale-specific, with a fallback to en-US. As a result, the display-name and description for adding a new Tag must get these in en-US even if optional for other languages. The maximum length of a description is 500 characters.

The read APIs of tags can be cached heavily and reused on the browser side for long durations, as the details of a Tag will not change often. The human readable tag-id should be used for all the Tag CRUD APIs and the UI routes. All the four portals would need read APIs for tags.

Each portal would also require /filter-tags APIs for finding tags. The search condition could be based on the tag's id or the display_name. The search should not be based on just prefix matching, but a fuzzy search to match any part of the string using pg_trgm trigrams. The sorting order will be based on the tag-id. The page size for filter-tags is 50 tags per page, using keyset pagination.

On update, the supplied locale translations fully replace all existing translations — locales omitted from the update request are deleted.

After the subsequent features like Posts, Openings are done, the HubUsers should be able to visit an UI URL on the HubUsers Portal to see the Openings, Posts corresponding to the Tag. For now, we will just build the underlying infra.

Delete operations are not supported for Tags
