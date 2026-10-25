# UX

Applies to designing, building, or changing any portal screen. Compose with
[`ui.md`](ui.md) (implementation) and the feature's guide. Follow it on the
first version; a screen that needs a redesign pass missed a rule here.

## Before building

- Name the screen's users, the one or two tasks they come for, and what they
  must see first. Order the page by that; rare configuration goes last or
  behind a tab.
- List every state before coding: loading, first use (empty), populated,
  warning, limit reached, error, refused (permission, plan, feature off), and
  phone width (390px).
- Copy the layout of an existing screen of the same kind instead of inventing
  one: list with filters (Openings list), long form (Opening editor),
  dashboard with settings (AI page).

## Page structure

- Order: breadcrumb when nested, `Title` level 1 with a status `Tag` when the
  page has an on/off or lifecycle state, one sentence saying what the page is
  for, then content.
- Never repeat context the shell, breadcrumb, or title already gives (no Org
  name above every page, no card title equal to its only field's label).
- Lead with the state the user checks most (balances, quotas, counts) as
  `Statistic` cards or `Progress` gauges above the details. Never hide it
  behind a tab.
- Tabs separate parallel views. The default tab is the most frequent task.
  Keep the open tab, filters, and page in the URL search params so reload,
  back, and shared links keep them.
- Lists: server-side pagination; search plus the one or two most used filters
  visible, the rest under "More filters" with a `Badge` count; state tabs with
  counts; `Empty` that offers the next action.
- Long forms: titled sections (`Collapse` or `Card`), two columns from `md`
  (`Col xs={24} md={12}`), "Optional" on optional fields, plain-language
  `extra` help on any field whose rule is not obvious, optional sections
  closed unless filled.
- Editors: a side panel (`Affix` from `lg`) holding the primary action, what
  saving does (quota, visibility, approval), a checklist of what the next step
  needs, and that next step. Offer a preview when others see the result.

## Orgs portal navigation

- The sidebar holds Org-level pages only, in one workspace at a time: Hiring,
  Agency, Services, Administration (`orgs-ui/src/app/workspaces.ts`). A
  workspace shows only when the Org does that work and the user may open one
  of its pages; the switcher shows only with two or more. Keep a workspace
  to five pages or fewer.
- Pages about the signed-in person (My work, My interviews, My account) live
  in the header's account menu, which names the person by address.
- A new page joins exactly one workspace, or the account menu when it shows
  only the person's own items. An Org-level list whose items belong to people
  (Jobs) filters by person instead of moving to the account menu, and starts
  on "Mine" when that is what most users come for.
- A page in two workspaces (Clients) keeps the workspace last chosen.

## Actions and saving

- One save scope per independent setting. Never put unrelated settings
  behind a shared Save.
- A switch whose effect is immediate saves at once. Turning something on that
  needs consent shows the terms in a dialog; turning off something others
  rely on asks first.
- A form with Save shows Save and Discard only after a change, tags it
  "Unsaved changes", and blocks leaving with `useUnsavedChangesGuard`.
- Never disable an action silently: say why beside it (the invalid choice,
  the missing fields, the plan or permission needed) and how to fix it.
- An Org whose plan lacks a feature sees what the plan adds and how to get
  it in place of the feature's controls; never a notice beside controls that
  still accept changes. Review every plan-gated screen on each plan.
- Confirm destructive or costly actions in a dialog that names the
  consequence and what is kept; the button repeats the verb ("Turn off",
  "Buy"), `danger` when destructive.
- After an action, say what happened with the real figures (credits used,
  tokens, what is left).
- Errors name the specific problem the API reported (blocking fields,
  inactive addresses), never a generic failure when the problem has details.

## Data and content

- Show names, never internal identifiers: display names for models and plans,
  translated states and enum values. Fall back to the identifier only for an
  item the catalog no longer has.
- One value per table column; numbers right-aligned (`align: "end"`); related
  columns under a group header (Input, Output) instead of "a in, b out" text.
- Show values users compare or that behave differently (monthly and purchased
  credits) as separate figures, not one combined total.
- Prefill what the system knows (the Org's country and language, the region's
  default model); never make users retype known facts.
- Explain a domain term in one sentence where a screen first relies on it
  (tokens, credits, quota).
- Never present a guess as a figure. No cost or count estimates the product
  cannot stand behind; show actual figures afterwards.
- `date` for days that matter without a time (expiry, renewal, history);
  `dateTime` for events.
- Percentages round down; show "Under 1%" rather than 0% once anything is
  used.
- Warn before a limit (80%) and alert at it, offering the fixing action (Buy
  credits). Colors come from theme tokens (`colorWarning`, `colorError`) and
  `Typography` `type`, never hex values, so both themes work.
- Show personal data such as email addresses only where the task needs it.

## Copy

- Sentence case, short, in the user's words; say what happens and what it
  costs. One term per concept across screens ([`glossary.md`](glossary.md)).
- Help and status text use `type="secondary"`.

## Check before done

- Run the screen on the dev stack and look at a screenshot of every state
  from "Before building", in light and dark themes, at 390px, and in German
  for text length. Fix anything that reads wrong (0%, raw identifiers,
  wrapping, misaligned numbers, duplicated headings) before review.
- UI tests cover the states that carry rules: empty, warning and limit,
  refusal reasons, unsaved-changes guard, URL-kept tab.
