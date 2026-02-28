Status: DRAFT
Authors: @psankar
Dependencies: None

## Acceptance Criteria

- A new user role called admin:manage-tags for Vetchium AdminPortal users
- AdminPortal users with either admin:manage_tags role or admin:superadmin should be able to:
  - Use APIs to CRU tags, enforced via middleware on the backend
  - See the tile on the UI to CRU tags on the Admin portal, under a UI route /manage-tags
- AdminPortal users without either of the above roles should not be able to use the APIs or see the tile on the UI homepage or visit the URL

## Scope

A Tag will be a site-wide feature working across portals. In future this will be used in various operations like creating an Opening on the Employer Portal, writing a Post on the HubUsers portal, A Hub User following the posts or jobs with a Tag, etc

A Tag will be having an unique human-readable ID in English. Ex: artificial-intelligence

A Tag will have a display name on a per-locale basis. If there is no translation available on a locale, the corresponding English string should be used. For example, en-US could have "Artificial Intelligence" which could map to "செயற்கை நுண்ணறிவு" in ta-IN, but appear as is for de-DE

A Tag can optionally have an Icon as an image which an admin user of Vetchium will be able to add, and an optional description string. The icons need to be in various sizes, one small for appearing in user's posts, one large for the tag's page. The description should also be marked for translation and be locale-specific, with a fallback to en-US.

The read APIs of tags can be cached heavily and reused on the browser side for long durations, as the details of a Tag will not change often. The human readable tag-id should be used for all the Tag CRUD APIs and the UI routes. All the four portals would need read APIs for tags.

Each portal would also require /filter-tags APIs for finding tags. The search condition could be based on the tag's id or the display_name. The search should not be based on just prefix matching, but a fuzzy search to match any part of the string. The sorting order will be based on the tag-id.

After the subsequent features like Posts, Openings are done, the HubUsers should be able to visit an UI URL on the HubUsers Portal to see the Openings, Posts corresponding to the Tag. For now, we will just build the underlying infra.

Delete operations are not supported for Tags
