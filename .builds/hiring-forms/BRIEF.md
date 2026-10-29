# Hiring forms build brief

The specification is `agent-guides/hiring-pipeline.md` HP-QST and HP-FRM
(and the `questions` row in `agent-guides/openings.md`). This brief records
how it was decided; the guide wins on any difference.

## Summary

An Org can attach application questions to an Opening (short or long text,
number, yes/no, single or multiple choice; each required or optional). Hub
users answer them on the apply page; the answers travel in the `hub-apply`
command and are stored with the application, and the Orgs portal shows them
on application detail and as optional columns on the Applicants and
Candidates tabs. An interview stage can carry a feedback form: criteria each
answered with a rating, yes/no, or text, which interviewers fill in beside the
existing recommendation and notes; application detail compares the answers
across interviewers. Out of scope: AI scoring or matching, résumés, and any
automatic rejection.

## Decisions

| Question | Answer |
| --- | --- |
| One build for both features? | Yes. |
| Where do questions live? | In `OpeningContent`; publish and revise approval guard them. |
| What does the Org get from answers? | Answers only. No acceptable answers, weights, or Meets/Fails. The only constraints are input validation: number min/max, text length, required. The apply form enforces them in its inputs. |
| Where does a feedback form attach? | To each `interview` stage of a pipeline template or Opening pipeline. |
| Criterion types | `rating` (1–5), `yes_no`, `text`. No choice type. |
| Recommendation and notes | Kept unchanged and required; criteria answers are added. |
| Edits after answers exist | Snapshot per answer. Warn when editing the questions of an Opening that was published; highlight answers given to a question that later changed or was removed. The same two rules apply to feedback forms. |
| Providers | Provider interviewers fill the routed stage's form; providers never see application answers. |
| Question types | `short_text`, `long_text`, `number`, `yes_no`, `single_choice`, `multiple_choice`; at most 8 options. |
| Hub view | The applicant sees their own answers read-only in Hub application detail. |
| Plans | Every plan; no entitlement. |
| Limits | 0–10 questions per Opening, 0–10 criteria per interview stage, text 1–500, options 2–8 of 1–200. |
| Lists | Column picker for up to 3 non-text questions on the Applicants and Candidates tabs, remembered per viewer and Opening in the browser. |
| Interviewer-only readers | See the answers. |

## API (existing operations, extended)

| Operation | API | Who | Change |
| --- | --- | --- | --- |
| `create-opening`, `save-opening-working-copy`, `get-opening`, `duplicate-opening`, `decide-opening-request` | orgs | as today | `OpeningContent.questions` |
| `get-org-opening`, mesh `org-openings/get` | hub, mesh | Hub user | live `questions` |
| `apply-to-opening`, `hub-apply` | hub, mesh | applicant | `answers`; `hub-application-answers-invalid` |
| `get-application` | orgs | every application reader | `answers` with `current`; feedback `criteria_answers` with `current` |
| `list-applications` | orgs | as today | `answer_columns` request, row `answers` |
| `get-my-application`, mesh `hub-applications/get` | hub, mesh | applicant | own `answers` |
| `create-pipeline-template`, `update-pipeline-template`, `list-pipeline-templates`, `get-opening-pipeline`, `replace-opening-pipeline` | orgs | `org:manage_openings` | `feedback_form` on interview stages |
| `submit-interview-feedback`, `submit-work-interview-feedback` | orgs | interviewer, provider interviewer | `criteria_answers`; `org-interview-feedback-answers-invalid` |
| provider work reads | orgs | provider | the stage's `feedback_form`; never answers |

## UI

| Portal | Route | Change |
| --- | --- | --- |
| Orgs | `/openings/new`, `/openings/:number/edit` | Questions editor; warning once published |
| Orgs | `/openings/:number` | Questions in the content view and revision comparison; answer column picker on Applicants and Candidates |
| Orgs | `/openings/:number/applications/:application` | Answers card with changed and removed highlights; per-interview criteria comparison |
| Orgs | pipeline templates page, Opening Pipeline tab | Feedback form editor per interview stage; warning when feedback exists |
| Orgs | feedback dialog (in-house and Work queue work item) | Criteria inputs |
| Hub | `/org/:domain/openings/:number/apply` | Question inputs with bounds |
| Hub | `/applications/:domain/:openingNumber/:applicationNumber` | Your answers |

## Out of scope

AI-generated questions or criteria, question libraries, scoring, filtering or
sorting by answers, saved column choices on the server, résumé files.
