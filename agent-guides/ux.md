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
- Right-hand panels of two-column pages use `SidePanel`
  (`@vetchium/portal-ui/shell`) in `Col lg={8}`: sticky from `lg`, scrolling
  inside itself when taller than the window.
- Editors: a side panel holding the primary action, what saving does (quota,
  visibility, approval), and a vertical `Steps` with one step per section: its
  status, what it still needs, the section in view as current, and a click
  opening and scrolling to it. Offer the next step (publish, submit) beside
  Save once the checklist is complete.
- Detail pages of an item with a lifecycle: `Title` with a status `Tag`, the
  content on the left, and a side panel holding the state, any pending
  request, and every lifecycle action. Disable an action the item is not ready
  for and list what it needs above it, with a link to fix it.
- A preview renders the same shared component as the page it previews, with
  that page's layout around it, so the two cannot drift.
- Long forms filled by others (apply pages): a side panel with a vertical
  `Steps` of the form's sections and a `Progress` of required answers above
  the submit button.

## Orgs portal navigation

- Below the pinned pages, the sidebar holds Org-level pages in one workspace
  at a time: Hiring, one per Capability the Org provides (named by the
  Capability's label), and Administration (`orgs-ui/src/app/workspaces.ts`).
  A workspace shows only when the Org does that work and the user may open
  one of its pages; the switcher shows only with two or more. Keep a
  workspace to five pages or fewer.
- The person's own work (Home, My interviews) is pinned above the workspace
  in every workspace (`pinnedPages`); their account (My account) is in the
  header's account menu, which names the person by address. A suspended Org
  pins nothing.
- A new page joins exactly one workspace, the pinned pages when it shows only
  the person's own work, or the account menu when it is account settings. An
  Org-level list whose items belong to people (Jobs) filters by person
  instead of moving out of its workspace, and starts on "Mine" when that is
  what most users come for.
- Home holds only what waits on the person or changes: alerts for limits the
  person can fix, counts from counts operations, then one preview card per
  role (first five rows and "See all"). A card shows only to a user its
  permissions or Capabilities let act on it; never static account or Org
  details.
- No page is in two workspaces. A Capability workspace's routes start with
  its Capability (`capabilityPath`: `/sourcing/jobs`,
  `/background-check/work/...`), so the URL alone picks the workspace; a page
  shared by Capabilities (Clients, Work queue) takes the Capability as a prop,
  filters by it, and redirects an item opened under another Capability's path
  to its own. The workspace last chosen applies only on pinned and
  account-menu pages.

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
