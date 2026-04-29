Create a new feature spec using the two-stage process defined in `specs/spec-template-README.md`.

## If $ARGUMENTS is empty

Ask the user these questions one at a time (wait for answers before proceeding):

1. **Feature name** — short slug used for the directory name (e.g. `org-sso`, `job-openings`, `hub-notifications`)
2. **Description** — what problem does this solve and for whom? (one paragraph is enough)
3. **Portal(s)** — which portals are affected? (Admin / Org / Hub — can be multiple)
4. **User types** — who initiates the action and who is affected?
5. **Constraints / edge cases** — anything non-obvious the spec must account for? (ok to say "none")

## Once you have the information (either from $ARGUMENTS or from the answers above)

1. Derive a kebab-case directory name from the feature name (e.g. "Org SSO" → `org-sso`)
2. Create the file `specs/{directory-name}/README.md`
3. Fill in **Stage 1 only** using the template at `specs/spec-template-README.md`:
   - Set `Status: DRAFT`
   - Fill Overview, Acceptance Criteria, User-Facing Screens, and API Surface from the information provided
   - Leave Stage 2 exactly as the blank template — do not fill it in
4. Tell the user:
   - The file path of the created spec
   - To review Stage 1, edit it manually, and set `Status: APPROVED` when the team agrees the requirements are correct
   - That once Stage 1 is approved, they can run `/fill-spec` to generate the implementation plan

## Quality rules

- Each spec should be completable in about a day or two of engineering work. If the feature is larger, split it into multiple specs with explicit dependencies between them.
- Be concise and precise — no filler sentences. Specs are read by both humans and LLMs; AI slop makes them worse for both.
- Screen sketches use plain HTML (forms and tables), not JSX or component names
- API Surface lists endpoint names and intent only — no TypeSpec, no types
- Acceptance criteria are specific and testable, not vague ("users can create foos" not "provide a good UX")
- If the description is ambiguous, make a reasonable assumption and note it in the spec rather than asking more questions
