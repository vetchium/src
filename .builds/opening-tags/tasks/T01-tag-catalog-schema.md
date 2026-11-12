# T01 Database: Seed the Opening tag catalog

## Requirements

OPN-TAG-001, OPN-TAG-002, OPN-TAG-003, OPN-TAG-009 (column and trigger only;
writes come in T03).

## Guides

`agent-guides/database.md`, `agent-guides/openings.md` (Tags section).

## Exemplars

- `db/migrations/00001_init.sql`: `vetchium.capabilities` and its seed
  `INSERT` (seeded OID table); `org_opening_contents` constraints such as
  `org_opening_contents_remote_check` (array checks with
  `vetchium.array_is_distinct`); the `REVOKE ... ON vetchium.audit_events`
  line; the audit-trigger loop at the end of the up section and the down
  section's `DROP` order.

## Steps

1. In `db/migrations/00001_init.sql`, before `vetchium.org_openings`, create:
   - `vetchium.opening_tags`: `tag_oid text PRIMARY KEY CHECK (char_length
     BETWEEN 2 AND 64 AND tag_oid ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
     `display_name text NOT NULL CHECK (display_name = btrim(display_name)
     AND char_length(display_name) BETWEEN 1 AND 100)`,
     `deprecated boolean NOT NULL DEFAULT false`.
   - `vetchium.opening_tag_names`: `tag_oid text NOT NULL REFERENCES
     vetchium.opening_tags (tag_oid)`, `language text NOT NULL CHECK
     (language ~ '^[a-z]{2,3}$' AND language <> 'en')`, `display_name text
     NOT NULL` with the same trim and 1–100 check, `PRIMARY KEY (tag_oid,
     language)`.
   - A comment above them: catalog OIDs identical in every tenant; never
     delete or rename; retire with `deprecated`.
2. Seed both tables in the same migration (one `INSERT` each). Default names:
   - `golang` Go, `python` Python, `java` Java, `javascript` JavaScript,
     `typescript` TypeScript, `rust` Rust, `c-sharp` C#, `c-plus-plus` C++,
     `kotlin` Kotlin, `swift` Swift, `php` PHP, `sql` SQL.
   - `artificial-intelligence` Artificial Intelligence, `machine-learning`
     Machine Learning, `generative-ai` Generative AI, `data-science` Data
     Science, `data-engineering` Data Engineering, `data-analytics` Data
     Analytics, `cloud-computing` Cloud Computing, `devops` DevOps,
     `site-reliability-engineering` Site Reliability Engineering,
     `cybersecurity` Cybersecurity, `frontend-development` Frontend
     Development, `backend-development` Backend Development,
     `full-stack-development` Full-Stack Development, `mobile-development`
     Mobile Development, `embedded-systems` Embedded Systems,
     `quality-assurance` Quality Assurance, `ui-ux-design` UI/UX Design,
     `product-management` Product Management.
   - `accounting` Accounting, `financial-analysis` Financial Analysis,
     `sales` Sales, `marketing` Marketing, `digital-marketing` Digital
     Marketing, `customer-support` Customer Support, `human-resources` Human
     Resources, `recruiting` Recruiting, `project-management` Project
     Management, `supply-chain-management` Supply Chain Management,
     `logistics` Logistics, `nursing` Nursing, `pharmacy` Pharmacy,
     `teaching` Teaching, `legal` Legal, `mechanical-engineering` Mechanical
     Engineering, `civil-engineering` Civil Engineering,
     `electrical-engineering` Electrical Engineering, `manufacturing`
     Manufacturing, `hospitality` Hospitality.
   - Localized names, `de`: `artificial-intelligence` Künstliche Intelligenz,
     `machine-learning` Maschinelles Lernen, `data-analytics` Datenanalyse,
     `cybersecurity` IT-Sicherheit, `quality-assurance` Qualitätssicherung,
     `product-management` Produktmanagement, `accounting` Buchhaltung,
     `sales` Vertrieb, `customer-support` Kundenservice, `human-resources`
     Personalwesen, `project-management` Projektmanagement, `logistics`
     Logistik, `nursing` Pflege, `pharmacy` Pharmazie, `legal` Recht,
     `mechanical-engineering` Maschinenbau, `civil-engineering`
     Bauingenieurwesen, `electrical-engineering` Elektrotechnik,
     `manufacturing` Fertigung, `hospitality` Hotellerie.
   - Localized name, `ta`: `artificial-intelligence` செயற்கை நுண்ணறிவு.
3. After the seed: `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
   vetchium.opening_tags, vetchium.opening_tag_names FROM vetchium_app;`
4. Add to `vetchium.org_opening_contents` a column `tag_oids text[]` (after
   `questions`) and constraint `org_opening_contents_tags_check`: `tag_oids
   IS NULL OR (cardinality(tag_oids) BETWEEN 1 AND 5 AND
   array_position(tag_oids, NULL) IS NULL AND
   vetchium.array_is_distinct(tag_oids) AND array_to_string(tag_oids, ',')
   ~ '^[a-z0-9]+(-[a-z0-9]+)*(,[a-z0-9]+(-[a-z0-9]+)*)*$')`. Leave
   `complete` unchanged (tags are optional).
5. Add `vetchium.check_opening_tag_oids()` and a `BEFORE INSERT OR UPDATE OF
   tag_oids ON vetchium.org_opening_contents FOR EACH ROW` trigger
   `org_opening_contents_tag_oids_known` that raises `foreign_key_violation`
   when any element is missing from `vetchium.opening_tags`. One comment line:
   a foreign key cannot cover array elements.
6. Down section: drop the trigger and function, then `opening_tag_names`,
   then `opening_tags`, after the tables that depend on them.
7. Add query `ListOpeningTags :many` in a new
   `backend/internal/db/queries/opening_tags.sql`: `tag_oid`,
   `display_name`, `deprecated`, and `localized_names` as
   `COALESCE(jsonb_object_agg(n.language, n.display_name) FILTER (WHERE
   n.language IS NOT NULL), '{}'::jsonb)`, grouped by tag, `ORDER BY
   tag_oid`, with a comment that the catalog is capped at 500 rows
   (OPN-TAG-003) so it has no pagination. Run `make sqlc`.
## Tests

- `make migration-check` proves the down section.
- No suite reads the catalog yet; T02's `playwright/api/opening-tags.spec.ts`
  asserts the seeded rows through both APIs. Database integration tests run
  in no make target (`docs/todo.md`), so add none here.
- Prove the column check and trigger by hand on the dev stack before
  committing (an `INSERT` with six tags, a repeat, and `nosuch-tag` each
  fail), and record the result in Notes; T03's API tests cover them through
  the writes.

## Checks

`make sqlc`, `make sql-check`, `make migration-check`, `make test-go`,
`make test-go-static`, then `make test`.

## Acceptance

- Both tables exist with the exact 50 tags and 21 localized names.
- `vetchium_app` can only read the catalog.
- `org_opening_contents.tag_oids` refuses 6 tags, repeats, nulls, malformed
  OIDs, and unknown OIDs.

## Carried over
