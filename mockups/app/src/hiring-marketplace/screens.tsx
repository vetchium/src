import type { Screen } from "../registry";
import * as C from "./orgs-consumer";
import * as H from "./hub";
import * as P from "./orgs-provider";

export const screens: Screen[] = [
  // Orgs — hiring (consumer)
  {
    id: "orgs-01-opening-applicants",
    title: "Orgs · Opening detail, Applicants tab",
    render: () => (
      <C.OpeningFrame tab="applicants">
        <C.ApplicantsTab />
      </C.OpeningFrame>
    ),
  },
  {
    id: "orgs-02-shortlist-dialog",
    title: "Orgs · Shortlist an applicant to a stage",
    render: () => <C.ShortlistModal />,
  },
  {
    id: "orgs-03-opening-candidates",
    title: "Orgs · Opening detail, Candidates tab (per-stage counts)",
    render: () => (
      <C.OpeningFrame tab="candidates">
        <C.CandidatesTab />
      </C.OpeningFrame>
    ),
  },
  {
    id: "orgs-04-opening-pipeline",
    title: "Orgs · Opening detail, Pipeline tab (edited directly, no approval)",
    render: () => (
      <C.OpeningFrame tab="pipeline">
        <C.PipelineTab />
      </C.OpeningFrame>
    ),
  },
  {
    id: "orgs-05-opening-providers",
    title:
      "Orgs · Opening detail, Providers tab (agencies and stage providers)",
    render: () => (
      <C.OpeningFrame tab="providers">
        <C.ProvidersTab />
      </C.OpeningFrame>
    ),
  },
  {
    id: "orgs-06-close-opening-dialog",
    title: "Orgs · Close Opening with bulk not-progressing",
    render: () => <C.OpeningOverviewWithCloseModal />,
  },
  {
    id: "orgs-07-application-provider-interview",
    title: "Orgs · Candidate at an interview stage routed to a provider",
    render: () => <C.ApplicationMarcus />,
  },
  {
    id: "orgs-08-schedule-interview",
    title: "Orgs · Schedule an in-house interview",
    render: () => <C.ScheduleInterviewModal />,
  },
  {
    id: "orgs-09-interview-feedback",
    title: "Orgs · Submit interview feedback (others hidden until you submit)",
    render: () => <C.FeedbackModal />,
  },
  {
    id: "orgs-10-application-background-check",
    title: "Orgs · Candidate at a background-check stage with results",
    render: () => <C.ApplicationSitiBackground />,
  },
  {
    id: "orgs-11-extend-offer",
    title: "Orgs · Extend offer (positions warning)",
    render: () => <C.ExtendOfferModal />,
  },
  {
    id: "orgs-12-record-joining",
    title: "Orgs · Offer accepted, record joining",
    render: () => <C.RecordJoiningModal />,
  },
  {
    id: "orgs-13-pipeline-templates",
    title: "Orgs · Pipeline templates",
    render: () => <C.TemplatesPage />,
  },
  {
    id: "orgs-14-pipeline-template-editor",
    title: "Orgs · Edit a pipeline template",
    render: () => <C.TemplatesPage drawer />,
  },
  {
    id: "orgs-15-new-opening-pipeline",
    title: "Orgs · New Opening editor, choosing a pipeline template",
    render: () => <C.OpeningEditorPipeline />,
  },
  {
    id: "orgs-16-find-providers",
    title: "Orgs · Find providers (search, incomplete results)",
    render: () => <C.FindProviders />,
  },
  {
    id: "orgs-17-listing-detail-propose",
    title: "Orgs · Listing detail with Propose engagement",
    render: () => <C.ListingDetail />,
  },
  {
    id: "orgs-18-your-engagements",
    title: "Orgs · Your engagements (as consumer)",
    render: () => <C.EngagementsTab />,
  },
  {
    id: "orgs-19-engagement-consumer-statement",
    title: "Orgs · Engagement detail and activity statement (consumer)",
    render: () => <C.EngagementDetail side="consumer" />,
  },
  {
    id: "orgs-20-invite-permissions",
    title: "Orgs · Invite people with new presets and permissions",
    render: () => <C.InvitePermissions />,
  },
  // Orgs — provider
  {
    id: "provider-01-listings",
    title: "Provider · Listings, one card per Capability",
    render: () => <P.ListingsPage />,
  },
  {
    id: "provider-02-listings-plan-gate",
    title: "Provider · Listings on the Free plan",
    render: () => <P.ListingsPlanGate />,
  },
  {
    id: "provider-03-listing-editor-background-check",
    title: "Provider · Background-check Listing editor",
    render: () => <P.ListingEditor />,
  },
  {
    id: "provider-04-clients",
    title: "Provider · Clients, proposals first",
    render: () => <P.ClientsPage />,
  },
  {
    id: "provider-05-engagement-statement",
    title: "Provider · Engagement detail and activity statement",
    render: () => <C.EngagementDetail side="provider" />,
  },
  {
    id: "provider-06-work-queue",
    title: "Provider · Work queue",
    render: () => <P.WorkQueue />,
  },
  {
    id: "provider-07-work-interview",
    title: "Provider · Routed interview work",
    render: () => <P.ProviderWorkItem />,
  },
  {
    id: "provider-08-work-background-check",
    title: "Provider · Recording background-check outcomes",
    render: () => <P.ProviderBackgroundCheck />,
  },
  // Orgs — agency
  {
    id: "agency-01-jobs",
    title: "Agency · Jobs",
    render: () => <P.JobsPage />,
  },
  {
    id: "agency-02-job-detail",
    title: "Agency · Job detail",
    render: () => <P.JobDetail />,
  },
  {
    id: "agency-03-suggest-to-contact",
    title: "Agency · Suggest an Opening to a contact",
    render: () => <P.SuggestModal />,
  },
  {
    id: "agency-04-contacts",
    title: "Agency · Contacts, also the shared inbox",
    render: () => <P.ContactsPage />,
  },
  {
    id: "agency-05-contact-conversation",
    title: "Agency · Contact, Conversation tab",
    render: () => <P.ContactConversation />,
  },
  {
    id: "agency-06-contact-messages-off",
    title: "Agency · Contact who turned agency messages off",
    render: () => <P.ContactConversation messagesOff />,
  },
  {
    id: "agency-07-contact-notes",
    title: "Agency · Contact, private Notes tab",
    render: () => <P.ContactNotes />,
  },
  {
    id: "agency-08-contact-not-contacted",
    title: "Agency · Contact with notes only, never messaged",
    render: () => <P.ContactNotContacted />,
  },
  {
    id: "agency-09-contact-profile",
    title: "Agency · Contact, Profile tab with verified domains and notes",
    render: () => <P.ContactProfile />,
  },
  {
    id: "agency-10-new-contact-profile",
    title: "Agency · New contact: profile view before any note or message",
    render: () => <P.NewContactProfile />,
  },
  {
    id: "agency-11-credited-applications",
    title: "Agency · Credited applications",
    render: () => <P.CreditedApplications />,
  },
  // Hub
  {
    id: "hub-01-home",
    title: "Hub · Home with applications and messages",
    render: () => <H.HubHome />,
  },
  {
    id: "hub-02-opening-apply",
    title: "Hub · Opening page with Apply",
    render: () => <H.HubOpeningApply />,
  },
  {
    id: "hub-03-apply",
    title: "Hub · Apply, with Referred by",
    render: () => <H.HubApply />,
  },
  {
    id: "hub-04-apply-referral-refused",
    title: "Hub · Apply, agency not eligible",
    render: () => <H.HubApply refused />,
  },
  {
    id: "hub-05-applications",
    title: "Hub · Applications",
    render: () => <H.HubApplications />,
  },
  {
    id: "hub-06-application-interview",
    title: "Hub · Application, interview response",
    render: () => <H.HubAppInterview />,
  },
  {
    id: "hub-07-request-another-time",
    title: "Hub · Request another interview time",
    render: () => <H.HubAppInterview reschedule />,
  },
  {
    id: "hub-08-application-consent",
    title: "Hub · Application, background-check consent",
    render: () => <H.HubAppConsent />,
  },
  {
    id: "hub-09-application-offer",
    title: "Hub · Application, offer",
    render: () => <H.HubAppOffer />,
  },
  {
    id: "hub-10-messages",
    title: "Hub · Messages with an Opening suggestion",
    render: () => <H.HubMessages />,
  },
  {
    id: "hub-11-messages-unavailable",
    title: "Hub · Conversation when the agency's region is down",
    render: () => <H.HubMessages unavailable />,
  },
  {
    id: "hub-12-preferences",
    title: "Hub · Preferences, Agencies may message me",
    render: () => <H.HubPreferences />,
  },
  {
    id: "hub-13-professional-emails",
    title: "Hub · Professional emails, what agencies see",
    render: () => <H.HubWorkEmails />,
  },
  // Phone and dark
  {
    id: "phone-01-hub-applications",
    title: "Phone (390px) · Hub applications",
    render: () => <H.HubApplications />,
    width: 390,
  },
  {
    id: "phone-02-hub-application-interview",
    title: "Phone (390px) · Hub interview response",
    render: () => <H.HubAppInterview />,
    width: 390,
  },
  {
    id: "phone-03-hub-messages-list",
    title: "Phone (390px) · Hub messages list",
    render: () => <H.HubMessagesListPhone />,
    width: 390,
  },
  {
    id: "phone-04-hub-conversation",
    title: "Phone (390px) · Hub conversation",
    render: () => <H.HubMessages />,
    width: 390,
  },
  {
    id: "dark-01-orgs-candidates",
    title: "Dark · Orgs Candidates tab",
    render: () => (
      <C.OpeningFrame tab="candidates">
        <C.CandidatesTab />
      </C.OpeningFrame>
    ),
    dark: true,
  },
  {
    id: "dark-02-agency-conversation",
    title: "Dark · Agency conversation",
    render: () => <P.ContactConversation />,
    dark: true,
  },
];
