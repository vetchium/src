# T01 Shared Opening content contract and catalogs

Requirements: OPN-GEN-005, OPN-CNT-001, OPN-CNT-002, the Content table in
`agent-guides/openings.md`.

Guides: `typespec.md`, `go.md`, `typescript.md`, `hub-profile.md` (language
abilities), `verification.md`.

Exemplars: `typespec/common/localization.*` (`CountryCode`),
`typespec/common/domain.*` (scalar with Go and TS normalization and tests),
`typespec/hub/profile/language_catalog.{json,go}` and
`typespec/scripts/generate-language-catalog.mjs`.

## Steps

1. Move the language catalog to `typespec/common/`: `git mv`
   `typespec/hub/profile/language_catalog.json` and `language_catalog.go`
   into `typespec/common/` (change the Go package), update the generator's
   output path, every Go and TS import (`git grep language_catalog`), and the
   path named in `agent-guides/hub-profile.md` PROF-LAN-003 and
   `agent-guides/openings.md`. Hub profile behavior must not change.
2. Add a currency catalog: `typespec/scripts/generate-currency-catalog.mjs`
   writes `typespec/common/currency_catalog.json`, the sorted output of
   `Intl.supportedValuesOf("currency")` (CLDR's current ISO 4217 codes), with
   a header comment in the script naming the source. Add Go and TS lookups
   with tests, as the language catalog has.
3. Add `typespec/common/openings.tsp` with Go and TS companions defining the
   shared vocabulary and `OpeningContent`:
   - extensible scalars with `x-vetchium-known-values`, as `OrgPlanOID` does:
     `OpeningWorkArrangement` (`on_site`, `hybrid`, `remote`),
     `OpeningEmploymentType` (`full_time`, `part_time`, `contract`,
     `internship`), `OpeningEducation` (`secondary`, `bachelor`, `master`,
     `doctorate`), `OpeningSalaryPeriod` (`hour`, `day`, `month`, `year`),
     `OpeningRemoteEligibilityKind` (`worldwide`, `countries`);
   - models `OpeningRemoteEligibility {kind, countries?: CountryCode[]}`,
     `OpeningExperienceYears {min?: int32, max?: int32}`,
     `OpeningSalary {currency, min: int64, max: int64, period}`;
   - `OpeningContent` with every field of the spec table optional on the
     wire: `title`, `description`, `language`, `employing_country`,
     `work_arrangement`, `location_details`, `remote_eligibility`,
     `employment_type`, `positions`, `experience_years`,
     `minimum_education`, `salary`.
4. Go and TS companions: `Normalize()` (trim text fields, uppercase country and
   currency codes, never drop duplicates silently — validation reports them;
   normalize a copy and leave the original unchanged), per-field validation returning field paths for
   every invalid field, and `MissingForPublication(content)` returning the
   field paths still required (title, description, language,
   employing_country, work_arrangement, employment_type, positions, and
   remote_eligibility when remote). Limits exactly as the spec table:
   title 1–200, description 1–20,000, location_details ≤2,000 code points;
   positions 1–10; experience 0–50 with min ≤ max; salary 0 ≤ min ≤ max,
   max ≥ 1, active currency; remote_eligibility only with `remote`;
   `countries` kind needs a non-empty unique list that includes the
   employing country when it is set; `worldwide` carries no list.
5. Tests in Go and TS for every rule, its boundaries on both sides, and
   normalization on a copy. Import the new files from `typespec/main.tsp` or
   the namespace entry as the other `common/` files are.

## Checks

`make typespec-check`, `make test-go`, `make hub-ui-check`,
`make orgs-ui-check`, then `make test`.

## Acceptance

- One content shape and one validator per language; Go and TS agree on
  every limit (a shared table-driven case list where the repo has one).
- The hub profile still accepts exactly the same language tags.
- No database, handler, or UI change in this task.
