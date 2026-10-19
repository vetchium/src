export const en = {
  shell: {
    documentTitle: "Vetchium for organizations",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium for organizations home",
    footer: "Vetchium for organizations",
    logout: "Sign out",
    operationInProgress: "Finish the operation in progress before leaving.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Open navigation",
    home: "Overview",
    members: "People",
    openings: "Openings",
    plans: "Billing",
    ai: "AI",
    settings: "Company",
    security: "My account",
    restoreDomain: "Restore domain",
    hiring: "Hiring",
    organization: "Organization",
    pipelineTemplates: "Pipeline templates",
    organizationSecurity: "Organization security",
  },
  theme: {
    toggleLabel: "Switch light or dark mode",
  },
  language: {
    selectorLabel: "Select language",
    changeError: "The language could not be changed. Please try again.",
  },
  common: {
    done: "Done",
    close: "Close",
    next: "Next",
    previous: "Previous",
    save: "Save",
    backToSignIn: "Back to sign in",
    cancel: "Cancel",
    confirm: "Confirm",
    continueToSignIn: "Continue to sign in",
    loadError: "This information could not be loaded.",
    loading: "Loading",
    retry: "Try again",
    unsavedTitle: "Leave without saving?",
    unsavedContent: "Your changes on this page are not saved yet.",
    unsavedLeave: "Leave",
    unsavedStay: "Stay",
  },
  fields: {
    confirmPassword: "Confirm password",
    domain: "Organization domain",
    domainState: "Verification",
    email: "Email address",
    failingSince: "Failing since",
    lastVerified: "Last verified",
    newPassword: "New password",
    orgDisplayName: "Organization name",
    orgCountry: "Country",
    password: "Password",
    permissions: "Permissions",
    recoveryCode: "Recovery code",
    releaseAfter: "Released after",
    totpCode: "Six-digit code",
  },
  validation: {
    displayName: "Use a name of 1 to 200 characters.",
    domain: "Enter a domain such as example.com, without @, http or www.",
    email: "Enter a valid email address.",
    newPassword: "Use 15 to 128 characters and avoid common password phrases.",
    passwordMatch: "The passwords do not match.",
    recoveryCode: "Enter a valid recovery code.",
    required: "This field is required.",
    totpCode: "Enter the six-digit code.",
    specialUseDomain:
      "Reserved names such as .test or .example cannot sign up. Enter your organization's real domain.",
    localPart: "Enter only the part before the @.",
  },
  errors: {
    generic: "The request could not be completed. Please try again.",
    validationFailed:
      "Some details were not accepted. Check them and try again.",
    rateLimited: "Too many attempts. Wait a moment and try again.",
    idempotencyConflict:
      "This action was already submitted with different details. Reload the page and try again.",
    signupUnavailable:
      "This region is not accepting organization signups right now.",
    signupDomainBlocked:
      "This domain cannot sign an organization up. Public email providers and reserved names such as .test or .example are not accepted. Use your organization's own domain.",
    domainAlreadyOwned:
      "Another organization on Vetchium already owns this domain.",
    invalidSignupToken:
      "This signup link is invalid, has expired, or was already used. Request a new one.",
    dnsRecordNotFound:
      "The TXT record is not visible yet. DNS changes can take a while to appear. Check the record below and try again.",
    directoryUnavailable:
      "Domain ownership cannot be checked right now. Try again in a few minutes.",
    invalidCredentials:
      "The organization domain, email address, or password is incorrect, or the selected region is wrong.",
    userDisabled:
      "This account is disabled. Contact a superadmin of your organization.",
    incorrectPassword: "The password was not accepted.",
    expiredLoginChallenge: "This sign-in has expired. Start again.",
    incorrectTOTP: "The code was not accepted.",
    incorrectRecoveryCode: "The recovery code was not accepted.",
    invalidResetToken:
      "This password reset link is invalid, has expired, or was already used.",
    invalidInvitation:
      "This invitation is invalid, has expired, was cancelled, or was already used. Ask for a new one.",
    invitationNotFound:
      "There is no pending invitation for an address in the request.",
    userAlreadyExists:
      "A user with this address already exists in the organization.",
    selfChange:
      "You cannot disable yourself or change your own permissions. Ask another administrator.",
    lastSuperadmin:
      "The organization must keep at least one active superadmin.",
    userNotFound: "{{email}} is not a user of this organization.",
    superadminRequired:
      "Only a superadmin can change {{email}} or these permissions.",
    userLimitReached:
      "The organization has no free seat: its plan allows {{limit}} users, counting pending invitations.",
    planNotOffered: "This region does not offer that plan.",
    pipelineTemplateNotFound:
      "This pipeline template no longer exists. Reload the page.",
    pipelineTemplateNameTaken:
      "Another pipeline template already has this name.",
    pipelineStageInUse:
      "A stage you removed still holds candidates. Move them to another stage first.",
    orgSuspended:
      "Your organization is suspended. Restore its domain to continue.",
    userLimitExceedsTarget:
      "Your organization has {{seats}} users and pending invitations, and this plan allows {{limit}}. Disable users or cancel invitations first.",
    logoInvalid:
      "That image cannot be used. Choose a PNG or JPEG that is not animated, with each side between 128 and 4,096 pixels.",
    logoTooLarge: "That image is larger than 2 MiB.",
    logoConflict:
      "The logo was changed by someone else at the same time. Try again.",
    ssoSignInFailed:
      "Google sign-in did not work. Check that you chose your organization's Google account, that your organization has Google sign-in turned on, and that you have been invited. You can sign in with your password instead.",
    ssoNotAvailable: "Google sign-in is not available in this region.",
    planRequired: "This needs a higher plan.",
    permissionRequired: "Only a superadmin of your organization can do this.",
    recentAuthenticationRequired: "Sign in again to continue.",
    totpAlreadyEnabled: "Two-factor authentication is already on.",
    totpNotEnabled: "Two-factor authentication is off.",
    invalidEnrollment: "This setup has expired. Start it again.",
  },
  signup: {
    regionDescription:
      "Choose where your organization's data will be kept, then enter your domain and email address.",
    selectRegion: "Select a region",
    regionLabel: "Region",
    regionOption: "{{region}} ({{tenant}})",
    noRegions: "No region accepts organization signups right now.",
    documentTitle: "Sign up | Vetchium for organizations",
    title: "Sign up your organization",
    description:
      "Your organization is identified by its domain. To prove that it controls the domain, you publish a DNS record we send you.",
    requester:
      "Whoever manages the domain for the organization, usually IT staff, should do this. The person who completes signup becomes the organization's first superadmin.",
    domainHelp:
      "The domain in your organization's email addresses, such as example.com, without www or https.",
    emailLabel: "Your email address",
    emailHelp:
      "You must be able to read mail at this address. You become the organization's first superadmin.",
    steps: {
      title: "What happens next",
      yourDomain: "your domain",
      emails: {
        title: "We send you two emails",
        content:
          "One holds a DNS TXT record for {{domain}}; you can forward it to whoever manages the domain's DNS. The other holds your private signup link; do not forward it.",
      },
      record: {
        title: "Publish the TXT record",
        content:
          "Add the record to the DNS for {{domain}}. This proves that your organization controls the domain. DNS changes can take a few hours to appear.",
      },
      complete: {
        title: "Open the private link and set your password",
        content:
          "Once the record is visible, open the link, name the organization, and choose your password. The record is checked again when you submit.",
      },
    },
    action: "Send signup emails",
    haveAccount: "Already signed up?",
    signIn: "Sign in",
    sent: {
      title: "Check your inbox",
      description:
        "If {{email}} can be used to sign up, two emails are on their way to it.",
      dnsTitle: "DNS instructions.",
      dnsBody:
        "This email holds the TXT record to publish for {{domain}}. You can forward it to whoever manages the domain's DNS.",
      linkTitle: "Private signup link.",
      linkBody:
        "Do not forward this email. Anyone with the link can complete the signup.",
      next: "After the record is published, open the private link to name the organization and choose your password.",
    },
  },
  terms: {
    documentTitle: "Terms for organizations | Vetchium",
    title: "Terms for organizations",
    version: "Version {{version}}",
    placeholder:
      "Placeholder text: these are not Vetchium's terms for organizations. The final terms will replace this page before launch.",
    sections: {
      service: {
        title: "Using Vetchium",
        body: "An organization uses Vetchium to publish Openings and manage hiring. The person who completes signup accepts these terms on the organization's behalf.",
      },
      accounts: {
        title: "Domain and accounts",
        body: "The organization keeps its domain verified and is responsible for the people it invites and the permissions it grants them.",
      },
      openings: {
        title: "Openings",
        body: "Vetchium does not verify Opening content. It may remove an Opening it finds unlawful, discriminatory, misleading, or abusive.",
      },
      changes: {
        title: "Changes to these terms",
        body: "When these terms change, their version changes, and the organization may be asked to accept the new version.",
      },
    },
  },
  completeSignup: {
    documentTitle: "Complete signup | Vetchium for organizations",
    title: "Complete your organization's signup",
    missingToken:
      "This signup link is incomplete. Open the full link from the email.",
    startOver: "Request a new signup link",
    instructions:
      "Publish this TXT record in the DNS for {{domain}}, then name the organization and choose your password. The record is checked when you submit.",
    expires: "Link expires",
    displayNameHelp:
      "Shown to people on Vetchium. It does not have to be unique.",
    countryHelp:
      "Where the organization is based. New Openings start with it as the employing country.",
    acceptTerms:
      "I accept the terms for organizations on this organization's behalf.",
    readTerms: "Read the terms for organizations (opens in a new tab)",
    termsRequired: "Accept the terms to create the organization.",
    action: "Verify domain and create organization",
    pending:
      "The domain is verified and the organization is being created. This page checks again automatically.",
    stillPending:
      "The organization is still being created. Check again in a few minutes.",
    checkAgain: "Check again",
    recordCheck: {
      checking: "Looking the record up in public DNS…",
      again: "Check again",
      present: {
        title: "The record is visible in public DNS.",
        description: "You can complete the signup now.",
      },
      absent: {
        title: "The record is not visible yet.",
        description:
          "DNS changes can take a few hours to appear. We recommend waiting and checking again before you submit. You can still submit now, but the signup only succeeds once the record is visible.",
      },
      inconclusive: {
        title: "The record could not be checked from your browser.",
        description: "You can still submit. The record is checked when you do.",
      },
    },
    success: "Your organization is ready. Sign in to continue.",
  },
  dnsRecord: {
    type: "Type",
    txt: "TXT",
    name: "Name",
    value: "Value",
  },
  region: {
    label: "Region",
    help: "Your organization's account lives in one region. Choose the region where it signed up.",
    option: "{{country}} ({{tenantId}})",
  },
  login: {
    documentTitle: "Sign in | Vetchium for organizations",
    title: "Sign in",
    description: "Sign in to your organization's account.",
    domainHelp: "Your organization's domain, such as example.com.",
    action: "Sign in",
    forgotPassword: "Forgot your password?",
    noAccount: "Organization not on Vetchium yet?",
    signUp: "Sign it up",
    or: "or",
    google: "Continue with Google",
  },
  googleCallback: {
    documentTitle: "Google sign-in | Vetchium for organizations",
    title: "Google sign-in",
    failed:
      "Google sign-in could not be completed. Start again, or sign in with your password.",
    back: "Back to sign-in",
  },
  twoFactor: {
    documentTitle: "Two-factor verification | Vetchium for organizations",
    title: "Verify it is you",
    description:
      "Enter the code from your authenticator app or one of your recovery codes.",
    methodLabel: "Verification method",
    authenticator: "Authenticator app",
    recovery: "Recovery code",
    action: "Verify",
    restart: "Start sign-in again",
    recoveryCodesLeft:
      "Recovery codes remaining: {{count}}. Replace them from the Security page when they run low.",
  },
  forgotPassword: {
    documentTitle: "Reset password | Vetchium for organizations",
    title: "Forgot your password?",
    description:
      "Enter your organization's domain and your email address. If they match an account, we will email you a reset link.",
    action: "Send reset link",
    checkEmail:
      "If the domain and email address match an account, a reset link is on its way.",
  },
  resetPassword: {
    documentTitle: "New password | Vetchium for organizations",
    title: "Choose a new password",
    missingToken:
      "This password reset link is incomplete. Open the full link from the email.",
    requestAnother: "Request a new reset link",
    success:
      "Your password was changed and your other sessions signed out. You can sign in now.",
    action: "Change password",
  },
  reauthentication: {
    title: "Sign in again to continue",
    description:
      "For your security, confirm your password before changing sign-in settings. You stay signed in.",
    action: "Confirm password",
    documentTitle: "Confirm password | Vetchium for organizations",
    pageTitle: "Confirm your password",
    pageDescription:
      "Changing sign-in settings needs a recent sign-in. You stay signed in either way.",
    account: "{{email}} at {{domain}}",
    confirm: "Continue",
  },
  home: {
    documentTitle: "Home | Vetchium for organizations",
    description: "Your organization on Vetchium.",
    domainCard: "Domain",
    accountCard: "Your access",
    noPermissions: "No permissions",
    title: "Overview",
  },
  permissions: {
    "org:superadmin": {
      name: "SUPERADMIN",
      description:
        "Everything in the organization, including billing and users, and the organization's settings.",
    },
    "org:manage_users": {
      name: "MANAGE_USERS",
      description:
        "Invite, disable and re-enable users, and change what they can do, except superadmin, billing, AI management, and Opening approval permissions.",
    },
    "org:manage_billing": {
      name: "MANAGE_BILLING",
      description: "Choose the organization's plan and billing interval.",
    },
    "org:manage_ai": {
      name: "MANAGE_AI",
      description:
        "Turn AI assistance on or off, choose which models each AI feature may use, buy AI credits, and review AI usage.",
    },
    "org:view_openings": {
      name: "VIEW_OPENINGS",
      description: "See every Opening of the organization, including drafts.",
    },
    "org:manage_openings": {
      name: "MANAGE_OPENINGS",
      description: "Create and edit Openings and submit requests for approval.",
    },
    "org:approve_openings": {
      name: "APPROVE_OPENINGS",
      description: "Approve or reject requests that change published Openings.",
    },
    "org:manage_candidacies": {
      name: "MANAGE_CANDIDACIES",
      description: "Read and act on the applications of every Opening.",
    },
    "org:manage_providers": {
      name: "MANAGE_PROVIDERS",
      description:
        "Find providers, propose and end engagements, assign them, and read activity statements.",
    },
    "org:manage_listings": {
      name: "MANAGE_LISTINGS",
      description:
        "Edit your Listings, accept or decline clients, and read activity statements.",
    },
    "org:fulfil_engagements": {
      name: "FULFIL_ENGAGEMENTS",
      description:
        "Do the work assigned to you for clients, and use agency contacts and messages.",
    },
    unknown: {
      description:
        "This permission was added after this portal was built. It is kept as it is unless you turn it off.",
    },
    includedBy: "Included by {{permission}}",
  },
  domain: {
    states: {
      verified: "Verified",
      failing: "Failing",
      released: "Released",
    },
    failing: {
      region: "Domain verification",
      title: "The verification record for {{domain}} is missing",
      description:
        "Recent checks could not find your domain's TXT record. Publish it again, or the domain will be released and your organization suspended.",
      descriptionWithDeadline:
        "Recent checks could not find your domain's TXT record. Publish it again. If it is still missing after {{releaseAfter}}, the domain will be released and your organization suspended.",
    },
    check: {
      action: "Check now",
      present: "The record was found. Your domain is verified.",
      presentButClaimed:
        "The record was found, but another organization has claimed the domain since it was released. It cannot be restored.",
      absent:
        "The record was not found. Check that it is published exactly as shown.",
      inconclusive:
        "The DNS lookup did not complete, so nothing changed. Try again later.",
      superadminOnly:
        "Only a superadmin of your organization can check the domain now. It is also checked automatically.",
    },
  },
  restore: {
    documentTitle: "Restore domain | Vetchium for organizations",
    title: "Restore your organization's domain",
    description:
      "{{domain}} has been released and your organization is suspended until the domain is verified again.",
    suspended: "Your organization is suspended",
    suspendedDetail:
      "The domain's TXT record was missing for too long. Until it is restored, you can only restore the domain, manage your own sign-in security, and sign out.",
    recordCard: "Record to publish",
    publish:
      "Publish this TXT record in the DNS for {{domain}}, then check it.",
    claimedElsewhere:
      "If another organization has claimed {{domain}} since it was released, it cannot be restored to this organization.",
  },
  security: {
    documentTitle: "My account | Vetchium",
    title: "My account",
    description: "Manage your personal sign-in and security settings.",
    password: {
      title: "Password",
      description: "Changing your password signs out your other sessions.",
      action: "Change password",
      changed: "Your password was changed.",
    },
    twoFactor: {
      title: "Two-factor authentication",
      description:
        "Add a code from an authenticator app to every sign-in. You can set it up, replace your recovery codes, or turn it off here.",
      status: "Two-factor authentication",
      recoveryCodes: "Unused recovery codes",
      statusEnabled: "On",
      statusDisabled: "Off",
      start: "Set up authenticator app",
      scan: "Scan this QR code with your authenticator app, or enter the key by hand. Then enter the code it shows.",
      qrLabel: "QR code for your authenticator app",
      manualKey: "Setup key",
      algorithm: "Algorithm",
      digits: "Digits",
      period: "Period",
      seconds: "{{seconds}} seconds",
      expires: "Setup expires",
      confirm: "Turn on",
      enabled: "Two-factor authentication is on.",
      disable: "Turn off",
      disableConfirm: "Turn off two-factor authentication?",
      disableWarning:
        "Signing in will need only your password, and your recovery codes will stop working.",
      disabled: "Two-factor authentication is off.",
    },
    recoveryCodes: {
      title: "Save your recovery codes",
      warning: "These codes are shown only once.",
      description:
        "Each code signs you in once if you lose your authenticator app. Store them somewhere safe.",
      copyAll: "Copy all codes",
      saved: "I have saved them",
      regenerate: "Replace recovery codes",
      regenerateConfirm:
        "Replace your recovery codes? The current codes will stop working.",
      regenerated: "New recovery codes were created.",
    },
  },
  ai: {
    documentTitle: "AI | Vetchium for organizations",
    title: "AI",
    description:
      "Turn AI assistance on, choose the models each AI feature may use, manage AI credits, and review how AI was used.",
    descriptionNotInPlan:
      "What AI assistance can do for your organization, and how to get it.",
    loading: "Loading AI settings",
    unavailable:
      "AI assistance is not offered in your organization's region yet.",
    tabs: {
      settings: "Settings",
      credits: "Credits",
      usage: "Usage",
    },
    operations: {
      "org-opening-draft": "Opening drafting",
    },
    draft: {
      button: "Draft with AI",
      title: "Draft with AI",
      help: "Describe the role or what to change. The draft fills the editor; nothing is saved until you save.",
      instructionLabel: "What should the AI write?",
      placeholder:
        "For example: a senior backend engineer for our payments team in Singapore, hybrid, five years of Go",
      modelLabel: "Model",
      modelOption: "{{name}} ({{vendor}})",
      generate: "Generate draft",
      review: "AI can be wrong. Review every field before you save.",
      applied:
        "Draft filled in. {{credits}} credits used ({{input}} input and {{output}} output tokens); {{left}} credits left. Review it, then save.",
      dropped:
        "Some fields the AI suggested were not valid and were left out: {{fields}}",
      unavailable: {
        notEnabled:
          "AI assistance is off for your organization. Someone with MANAGE_AI can turn it on in AI settings.",
        planRequired: "Drafting with AI comes with the Gold plan.",
        changePlan: "Save your work, then change the plan under Billing.",
        noCredits: "Your organization has no AI credits left.",
        noModel: "No AI model is available for drafting.",
        operationOff:
          "Your organization has turned off Opening drafting with AI. Someone with MANAGE_AI can turn it back on in AI settings.",
      },
      errors: {
        notEnabled: "AI assistance is off for your organization.",
        planRequired: "Drafting with AI needs the Gold plan.",
        noCredits:
          "Your organization does not have enough AI credits for this draft.",
        modelNotAllowed:
          "Your organization no longer allows that model. Choose another one.",
        inProgress: "This draft is still being written. Wait a moment.",
        modelFailed:
          "The AI model did not answer. No credits were used. Try again.",
        unusable:
          "The AI's answer could not be used. No credits were used. Try rewording your request.",
        operationOff:
          "Your organization has turned off Opening drafting with AI.",
      },
      available: "{{available}} credits available.",
    },
    settings: {
      title: "AI assistance",
      unavailableModels:
        "This region no longer offers some models your organization chose: {{models}}. The region's default is used instead.",
      enabled: "AI assistance",
      on: "On",
      off: "Off",
      termsAccepted: "AI terms version {{version}} accepted on {{date}}.",
      modelsTitle: "AI features",
      saved: "{{feature}} settings saved.",
      errors: {
        termsRequired: "Accept the current AI terms to turn AI assistance on.",
        modelNotOffered: "This region does not offer: {{models}}",
      },
      onHelp: "People with the right permissions can use AI features.",
      offHelp: "Nobody in your organization can use AI features.",
      turnedOn: "AI assistance turned on.",
      turnedOff: "AI assistance turned off.",
      turnOffTitle: "Turn AI assistance off?",
      turnOffContent:
        "Nobody in your organization can use AI features until it is turned on again. Credits, settings, and usage history are kept.",
      turnOff: "Turn off",
      modelsHelp:
        "Choose which models each AI feature may use, or turn a feature off. Each feature saves on its own.",
      modelsFor: "Models for {{feature}}",
      modeAll: "All models in this region",
      modeAllHelp:
        "Models added later are allowed too. {{model}} is preselected.",
      modeSelected: "Only the models I choose",
      modeSelectedHelp:
        "Pick the allowed models and the one preselected for people.",
      modeOff: "Off",
      modeOffHelp: "Nobody in your organization can use {{feature}}.",
      allow: "Allow",
      allowModel: "Allow {{model}}",
      preselected: "Preselected",
      preselectModel: "Preselect {{model}}",
      chooseModel: "Choose at least one model, or turn the feature off.",
      unsaved: "Unsaved changes",
      save: "Save",
      discard: "Discard",
    },
    terms: {
      title: "AI terms",
      p1: "Placeholder text: replace it with the reviewed AI terms before launch.",
      p2: "AI features send the text you write, and the content they work on, to the AI models of your organization's region. Models run in that region.",
      p3: "Vetchium keeps each prompt and answer for a limited time for support and abuse review. People in your organization with MANAGE_AI, and Vetchium administrators with a dedicated permission, can read them; every administrator read is recorded.",
      p4: "AI output can be wrong or incomplete. People in your organization review it before it is saved or published.",
      accept:
        "I accept the AI terms (version {{version}}) for my organization.",
      acceptAndTurnOn: "Accept and turn on",
    },
    models: {
      title: "Models in this region",
      name: "Model",
      vendor: "Vendor",
      licence: "Licence",
      rates: "Credits per million tokens",
      inputRate: "Input tokens",
      outputRate: "Output tokens",
      tokensHelp:
        "Models charge separately for the tokens they read (input: the instructions, your request, and the content they work on) and the tokens they write (output). A token is about three quarters of an English word.",
      status: "Availability",
      offered: "Offered",
      withdraws: "Offered until {{date}}",
    },
    credits: {
      grantIncluded:
        "Your plan includes {{credits}} AI credits each month. They are used first and lapse at the end of the month.",
      grantNotIncluded: "Your plan includes no monthly AI credits.",
      packsTitle: "Buy credits",
      simulated:
        "Payments are simulated during development: buying a pack adds its credits without charging you. Purchased credits expire twelve months after purchase.",
      goldOnly: "Buying credits needs the Gold plan.",
      packCredits: "{{credits}} credits",
      buy: "Buy",
      buyTitle: "Buy {{credits}} credits?",
      buySimulated:
        "The listed price is {{price}}. Payments are simulated during development, so you will not be charged.",
      bought: "Credits added.",
      lotsTitle: "Credit history",
      noLots: "No credits yet",
      kind: "Source",
      kinds: {
        grant: "Monthly credits",
        purchase: "Purchase",
      },
      granted: "Credits",
      remaining: "Left",
      added: "Added",
      expires: "Expires",
    },
    usage: {
      title: "AI usage",
      help: "Every AI request, newest first. Prompts and answers are kept for a limited time.",
      empty: "No AI requests yet",
      when: "When",
      operation: "Feature",
      model: "Model",
      user: "User",
      outcome: "Outcome",
      states: {
        reserved: "In progress",
        settled: "Completed",
        released: "Failed",
        abandoned: "Abandoned",
      },
      failures: {
        model_failed: "Model failed",
        unusable_output: "Unusable answer",
        abandoned: "Abandoned",
      },
      tokens: "Tokens",
      inputTokens: "Input",
      outputTokens: "Output",
      credits: "Credits",
      text: "Prompt and answer",
      view: "View",
      viewFor: "View the prompt and answer from {{time}}",
      deleted: "Deleted",
      textTitle: "Prompt and answer",
      textUnreadable:
        "You cannot read this prompt: it is about Openings, and you cannot view the organization's Openings.",
      textExpires: "Kept until {{date}}.",
      roles: {
        system: "Instructions",
        user: "Request",
      },
      answer: "Answer",
      noAnswer: "The model gave no answer.",
    },
    statusOn: "AI on",
    statusOff: "AI off",
    statusNotInPlan: "Not in your plan",
    offNotice:
      "AI assistance is off, so nobody in your organization can use AI features.",
    openSettings: "Open settings",
    purchasedOnly:
      "Your plan no longer includes AI. Your organization can keep using its {{credits}} purchased credits until they run out or expire; buying more needs the Gold plan.",
    upgrade: {
      title: "AI assistance comes with the Gold plan",
      intro: "With Gold, people in your organization get:",
      drafting:
        "Opening drafts written by AI from a short description, ready for review",
      monthly: "{{credits}} AI credits every month",
      packs: "More credits to buy whenever you need them",
      seePlans: "See plans",
      askBilling:
        "Ask someone who manages billing in your organization to move to the Gold plan.",
    },
    summary: {
      monthlyTitle: "This month's credits",
      purchasedTitle: "Purchased credits",
      percentUsed: "{{percent}}% used",
      underOnePercent: "Under 1% used",
      gaugeLabel: "{{title}}: share used",
      left: "{{left}} of {{total}} left",
      monthlyRenews: "Renews on {{date}}. Unused credits lapse then.",
      monthlyPending:
        "Your plan includes {{credits}} credits each month. This month's credits arrive shortly.",
      monthlyNone: "Your plan includes no monthly credits. The Gold plan does.",
      purchasedExpires: "The earliest purchase expires on {{date}}.",
      purchasedNone: "No purchased credits.",
      buy: "Buy credits",
      warning:
        "{{percent}}% of your AI credits are used. Buy more before they run out.",
      exhausted:
        "Your AI credits are used up. AI features stop until you buy credits or next month's credits arrive.",
      reserved: "{{credits}} credits are held by AI requests in progress.",
    },
  },
  plans: {
    documentTitle: "Plan and billing | Vetchium for organizations",
    title: "Billing",
    description: "Manage your organization’s plan and seat allowance.",
    loadingLabel: "Loading plans",
    names: {
      "org-free-tier": "Free",
      "org-silver-tier": "Silver",
      "org-gold-tier": "Gold",
    },
    current: {
      title: "Current plan",
      plan: "Plan",
      seatsLabel: "Users",
      seats: "{{used}} of {{limit}} seats used (users and pending invitations)",
      seatsUnlimited: "{{used}} seats used (no limit)",
    },
    unknownPlanTitle: "Unrecognized plan",
    unknownPlanDescription:
      "This organization is on {{plan}}, which this version of the portal does not know. Plan changes are turned off until the portal is updated.",
    interval: {
      month: "Monthly",
      year: "Annual",
    },
    pricePeriod: {
      month: "per month",
      year: "per year",
    },
    billingIntervalLabel: "Billing interval",
    annualSaving: "One month free",
    pricingNote: "Prices are per organization, not per user, and include tax.",
    introductoryPricing: "Introductory pricing",
    fossNote:
      "Paid plans fund the development of Vetchium, a free and open-source project.",
    planCardLabel: "{{plan}} plan",
    featuresTitle: "What’s included",
    descriptions: {
      "org-free-tier": "For small teams getting started with hiring.",
      "org-silver-tier":
        "For growing teams that hire regularly under their own brand.",
      "org-gold-tier":
        "For larger organizations hiring at scale, with AI assistance and Google sign-in.",
    },
    currentBadge: "Current",
    freePrice: "Free",
    freePriceCaption: "always",
    comingSoon: "Coming soon",
    yes: "Included",
    no: "Not included",
    features: {
      users: "Up to {{count}} users",
      usersWithGoogle: "Up to {{count}} users, unlimited with Google sign-in",
      openings: "{{count}} job openings per year",
      logo: "Organization logo",
      googleSignIn: "Google sign-in",
      ticketSupport: "Ticket-based support",
      mcp: "MCP support",
      aiCredits: "{{count}} AI credits a month",
      listings: "Marketplace Listings",
    },
    comparison: {
      feature: "Feature",
      users: "Users",
      openings: "Job openings per year",
      logo: "Organization logo",
      googleSignIn: "Google sign-in",
      ai: "AI assistance",
      listings: "Marketplace Listings",
      ticketSupport: "Ticket-based support",
      mcp: "MCP support",
    },
    actions: {
      current: "Current plan",
      upgrade: "Upgrade",
      switchToFree: "Switch to Free",
      interval: "Change billing interval",
      downgrade: "Downgrade",
    },
    confirmTitle: "Change to {{plan}}?",
    confirmBack: "Go back",
    lockedSuspended:
      "The plan cannot be changed while the organization is suspended.",
    change: "Change plan",
    back: "Back to billing",
    development:
      "Development: these prices are not charged. Plan changes are free and immediate.",
    compare: "Compare all features",
    immediate: "This change applies immediately. Nothing is charged.",
    changed: "Plan updated",
    losesLogo:
      "Your logo will be removed. Upgrading again will not restore it.",
    losesGoogle:
      "Google sign-in will be turned off. Upgrading again will not turn it back on.",
    excessSeats:
      "{{used}} seats are in use; the target plan allows {{limit}}. Disable users or cancel invitations first.",
  },
  settings: {
    documentTitle: "Company | Vetchium",
    title: "Company",
    description: "Manage your company name and logo.",
    logo: {
      title: "Logo",
      help: "Shown next to your organization's name. Use a PNG or JPEG that is not animated, up to 2 MiB, with each side between 128 and 4,096 pixels. The image is re-encoded and its metadata removed.",
      none: "No logo is set.",
      alt: "Logo of {{name}}",
      upload: "Upload logo",
      replace: "Replace logo",
      remove: "Remove logo",
      upgrade: "A logo needs the Silver plan or higher.",
      seePlans: "See plans",
    },
    google: {
      title: "Google sign-in",
      help: "Let your users sign in with their Google Workspace accounts. Only users already in this organization can sign in, with an address on your domain verified by Google. Your Google administrator's 2-Step Verification replaces the authenticator code, and passwords keep working. While it is on, the user limit is lifted.",
      on: "On",
      off: "Off",
      upgrade: "Google sign-in needs the Gold plan.",
      seePlans: "See plans",
    },
  },
  roles: {
    superadmin: "Superadmin",
    finance: "Finance",
    userManager: "User manager",
    recruiter: "Recruiter",
    hiringApprover: "Hiring approver",
    vendorManager: "Vendor manager",
    providerStaff: "Provider staff",
    member: "Member",
    custom: "Custom",
  },
  users: {
    documentTitle: "Members | Vetchium for organizations",
    title: "People",
    description:
      "Invite people, choose what each can do, and turn accounts off when they leave.",
    tabs: {
      members: "Members",
      invitations: "Invitations",
    },
    role: "Role",
    roleOf: "Role of {{email}}",
    permissionGranted: "Granted",
    you: "you",
    never: "Never",
    actionsFor: "Actions for {{email}}",
    searchPlaceholder: "Search by email address",
    clearFilters: "Clear filters",
    page: "Page {{page}}",
    empty: {
      default: "No members yet.",
      filtered: "No members match these filters.",
    },
    columns: {
      state: "State",
      joined: "Joined",
      lastSignIn: "Last sign-in",
      actions: "Actions",
    },
    state: {
      active: "Active",
      disabledManual: "Disabled",
      "disabled-manual": "Disabled",
    },
    filters: {
      state: "State",
      role: "Role",
    },
    filterState: {
      active: "Active",
      "disabled-manual": "Disabled",
    },
    sort: {
      label: "Sort by",
      email: "Email address",
      joined: "Join date",
      ascending: "Ascending",
      descending: "Descending",
    },
    summary: {
      seats:
        "{{used}} of {{limit}} seats used (members and pending invitations)",
      seatsUnlimited: "{{used}} seats used (no limit)",
      roles: "Roles:",
      states: "States:",
      role: {
        superadmin: "{{count}} superadmin",
        finance: "{{count}} finance",
        userManager: "{{count}} user managers",
        member: "{{count}} members",
      },
      state: {
        active: "{{count}} active",
        "disabled-manual": "{{count}} disabled",
      },
    },
    bulk: {
      selected: "{{count}} selected",
      limit: "At most {{count}} can be selected at once.",
      setRole: "Set role",
      disable: "Disable",
      enable: "Enable",
      clear: "Clear selection",
    },
    roleChange: {
      confirm: "Make {{count}} selected user(s) {{role}}?",
      effect:
        "The new role applies on their next request. Sign-ins stay active.",
      action: "Change role",
      saved: "The role was changed.",
    },
    disable: {
      confirm: "Disable {{count}} user(s)?",
      effect:
        "They are signed out at once and cannot sign in until re-enabled. Their seat is freed.",
      action: "Disable",
      done: "The users were disabled.",
    },
    enable: {
      confirm: "Enable {{count}} user(s)?",
      effect: "They can sign in again. This uses a seat each.",
      action: "Enable",
      done: "The users were enabled.",
    },
    custom: {
      option: "Custom…",
      edit: "Edit permissions…",
      title: "Custom permissions",
      hint: "Choose exactly what this user may do. A role is only a shortcut for a set of these.",
    },
    invite: {
      open: "Invite people",
      title: "Invite people",
      action: "Send invitations",
      addresses: "Email addresses",
      addressesHelp:
        "Paste addresses separated by commas, spaces or new lines, or choose a CSV file. They must be at your organization's domain.",
      chooseFile: "Choose CSV file",
      count: "{{count}} addresses",
      batches: "Sent in {{count}} requests of up to 100 each.",
      results: "{{invited}} of {{total}} invitations were sent.",
      outcome: "Result",
      outcomes: {
        invited: "Invited",
        "already-member": "Already a member",
        "already-invited": "Already invited",
        "domain-mismatch": "Not at your domain",
        invalid: "Not an email address",
      },
    },
    export: {
      action: "Export CSV",
      progress: "Exported {{count}}…",
      failed: "The export could not be completed.",
    },
  },
  invitations: {
    search: "Search invitations by email address",
    empty: "No pending invitations.",
    invitedBy: "Invited by",
    expires: "Expires",
    expired: "Expired",
    resend: "Resend",
    resendFor: "Resend the invitation to {{email}}",
    resent: "The invitation was sent again.",
    cancelAction: "Cancel",
    cancelFor: "Cancel the invitation to {{email}}",
    cancelSelected: "Cancel selected",
    cancelConfirm: "Cancel {{count}} invitation(s)?",
    cancelEffect:
      "The links in those emails stop working and the seats are freed.",
    cancelled: "The invitations were cancelled.",
  },
  acceptInvitation: {
    documentTitle: "Accept invitation | Vetchium for organizations",
    title: "Join your organization",
    missingToken:
      "This invitation link is incomplete. Open the full link from the email.",
    expires: "Invitation expires",
    action: "Create account",
    success: "Your account is ready. Sign in to continue.",
  },
  notFound: {
    title: "Page not found",
    description: "The page you requested does not exist.",
    action: "Go to home",
  },
  company: {
    identity: "Company identity",
    name: "Company name",
    saved: "Company details saved",
    country: "Country",
    countryHelp:
      "Where the company is based. New Openings start with it as the employing country.",
    defaultLanguage: "Default language",
    defaultLanguageHelp:
      "Used for invitations and as the starting language of new Openings. Each member still receives their own emails in their own language.",
    invalidName: "Enter a name of 1 to 200 characters.",
    securityTitle: "Organization security | Vetchium",
    confirmGoogle: "Change Google sign-in?",
    enableGoogle:
      "Members can sign in with their Google Workspace accounts. Workspace security policies apply.",
    disableGoogle:
      "Members will need their password and any configured two-factor authentication to sign in.",
  },
  people: {
    manage: "Manage",
    member: "Member details",
    self: "You cannot change your own access.",
    restricted: "Only a superadmin can change restricted permissions.",
    approvalRestricted:
      "Only a superadmin can grant or revoke Opening approval.",
    selection:
      "Only checked rows are selected, including other pages. Maximum {{count}}.",
    full: "All available seats are in use. Disable a user or cancel an invitation before inviting more people.",
  },
  openings: {
    intro:
      "Create Openings, send them for approval, and track every Opening your organization runs.",
    breadcrumbOpening: "{{title}} #{{number}}",
    pendingTag: "Pending: {{kind}}",
    columns: { opening: "Opening" },
    tabs: {
      all: "All",
      withCount: "{{state}} ({{count}})",
      overview: "Overview",
      pipeline: "Pipeline",
      applicants: "Applicants",
      candidates: "Candidates",
    },
    stats: {
      quota: "Opening quota",
      published: "Published",
      publishedHelp: "Visible to candidates on Vetchium now.",
      review: "Review requests",
      showAll: "Show all Openings",
      newApplicants: "New applicants",
      candidates: "Candidates",
      hired: "Hired",
      ofPositions: "/ {{count}}",
      positionsLabel_one: "position",
      positionsLabel_other: "positions",
      overHired: "More people joined than planned.",
    },
    documentTitle: "Openings | Vetchium",
    title: "Openings",
    new: "New Opening",
    untitled: "Untitled draft",
    empty: "No Openings are available to you for these filters.",
    quota: "Openings created in the last 365 days: {{used}} of {{limit}}",
    fields: {
      title: "Title",
      description: "Description",
      language: "Language",
      state: "State",
      country: "Employing country",
      hiringManager: "Hiring manager",
      updated: "Updated",
      workArrangement: "Work arrangement",
      locationDetails: "Location details",
      remoteEligibility: "Remote eligibility",
      employmentType: "Employment type",
      positions: "Positions",
      experienceYears: "Experience in years",
      minimumEducation: "Minimum education",
      salary: "Salary",
    },
    filters: {
      more: "More filters",
      awaitingActive: "Showing Openings with a request awaiting your approval.",
      pendingKinds: "Pending request types",
      awaitingApproval: "Awaiting my approval",
      hiringManager: "Hiring manager email",
      recruiter: "Recruiter email",
      title: "Search title",
      clear: "Clear filters",
    },
    states: {
      draft: "Draft",
      discarded: "Discarded",
      published: "Published",
      paused: "Paused",
      closed: "Closed",
      expired: "Expired",
    },
    requestKinds: {
      publish: "Publish",
      revise: "Revise",
      pause: "Pause",
      reopen: "Reopen",
      close: "Close",
    },
    requestStates: {
      pending: "Pending",
      approved: "Approved",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
      superseded: "Superseded",
      cancelled: "Cancelled",
    },
    workArrangements: {
      on_site: "On site",
      hybrid: "Hybrid",
      remote: "Remote",
    },
    employmentTypes: {
      full_time: "Full time",
      part_time: "Part time",
      contract: "Contract",
      internship: "Internship",
    },
    remote: { worldwide: "Worldwide", countries: "Selected countries" },
    education: {
      secondary: "Secondary",
      bachelor: "Bachelor's",
      master: "Master's",
      doctorate: "Doctorate",
    },
    salaryPeriods: {
      hour: "per hour",
      day: "per day",
      month: "per month",
      year: "per year",
    },
    experienceRange: "{{min}}–{{max}} years",
    experienceMin: "From {{min}} years",
    experienceMax: "Up to {{max}} years",
    editTitle: "Edit Opening",
    newTitle: "New Opening",
    detailTitle: "Opening #{{number}} | Vetchium",
    saved: "Opening content saved.",
    created: "Draft created.",
    discardedWorking: "Working copy discarded.",
    discardedDraft: "Draft discarded.",
    revision: "Revision",
    expiresAt: "Expires",
    pendingRequest: "Pending request",
    publicationMissing: "Complete these fields before publishing:",
    actions: {
      title: "Opening actions",
      effects: {
        publish: "Publish",
        revise: "Publish revision",
        pause: "Pause",
        reopen: "Reopen",
        close: "Close",
      },
      submitForApproval: "Submit for approval: {{action}}",
      submit: "Submit for approval",
      approve: "Approve",
      reject: "Reject",
      withdraw: "Withdraw request",
      withdrawn: "Request withdrawn.",
      saved: "Opening updated.",
      requestKind: "Requested change",
      requester: "Requested by",
      requestedAt: "Requested at",
      note: "Note",
      optionalNote: "Add an optional note (up to 2,000 characters).",
      rejectNote: "Give a reason for rejecting this request.",
      openApplications: "Applications",
      applicationsMarked: "Marked not progressing",
      applicationsKept: "Kept open so hiring can finish",
      markNotProgressing_one:
        "Also mark the {{count}} open application as not progressing ({{applicants}} applicants, {{candidates}} candidates)",
      markNotProgressing_other:
        "Also mark the {{count}} open applications as not progressing ({{applicants}} applicants, {{candidates}} candidates)",
      markNotProgressingHelp:
        "They see “Not progressing” in Vetchium. Upcoming interviews are cancelled and extended offers are withdrawn. Leave this off to keep hiring from the people already in progress.",
      approveMarksApplications:
        "Approving also marks every open application as not progressing.",
      consequences: {
        pause:
          "Pausing hides this Opening from candidates until it is reopened.",
        close:
          "Closing ends this Opening permanently. To hire again, duplicate it as a new draft.",
      },
    },
    publicURL: "Public Hub URL",
    copyURL: "Copy URL",
    copied: "URL copied.",
    copyFailed: "Could not copy the URL.",
    liveContent: "Live content",
    draftContent: "Draft content",
    workingContent: "Working copy",
    notSet: "Not set",
    notFound: "Opening not found or unavailable.",
    edit: "Edit",
    editTeam: "Edit team and notes",
    duplicate: "Duplicate",
    discardDraft: "Discard draft",
    discardWorking: "Discard working copy",
    confirmDiscardDraft: "Discard this draft and its content?",
    confirmDiscardWorking:
      "Discard this working copy? Live content stays published.",
    disabledMember: "Disabled",
    history: "History",
    systemActor: "System",
    editor: {
      optional: "Optional",
      newIntro:
        "Describe the role for candidates. You can save an incomplete draft and finish it later.",
      editIntro:
        "Update this Opening. Switch to Candidate preview to see it as candidates will.",
      tabs: { edit: "Edit" },
      sections: {
        basics: "Basics",
        location: "Location",
        role: "Role and requirements",
      },
      help: {
        title: "The job title candidates search for, such as Backend engineer.",
        description:
          "Markdown works here: headings, lists, bold, italics, and links. Check Candidate preview for the result.",
        language: "The language this Opening is written in.",
        country: "The country where the person hired will be employed.",
        remoteEligibility:
          "Where candidates may live. A country list must include the employing country.",
        locationDetails:
          "Optional. City, office address, or travel expectations.",
        positions: "How many people you will hire, from 1 to 10.",
        salary:
          "Optional. To show a salary, fill in all four fields; otherwise leave them all empty.",
        hiringManager:
          "Required to publish. Must be an active member of your organization.",
        recruiter:
          "Required to publish. May be the same person as the hiring manager.",
        teamMembers:
          "Optional. Up to 20 active members who help with this Opening.",
        internalNotes:
          "Only your organization sees these notes. Candidates never do.",
      },
      previewHelp:
        "This is how candidates will see this Opening once it is published.",
      previewEmpty:
        "Nothing to preview yet. Add a title and description on the Edit tab.",
      actions: {
        title: "Actions",
        newHelp:
          "Creating a draft takes one slot of your Opening quota. Drafts stay private to your organization.",
        draftHelp:
          "Saving updates this draft. Candidates see nothing until it is published.",
        revisionHelp:
          "Changes are saved as a revision. Candidates keep seeing the live Opening until the revision is published.",
        nextStep:
          "After saving, publish the Opening or submit it for approval from its page.",
      },
      checklist: {
        title: "Publication checklist",
        progress: "{{done}}/{{total}}",
        help: "You can save at any time. Publishing needs every item below.",
        ready: "Everything needed to publish is in place.",
        done: "Complete",
        missing: "Not complete",
      },
      team: "Hiring team and notes",
      recruiter: "Recruiter",
      teamMembers: "Team members",
      internalNotes: "Internal notes",
      minimumYears: "Minimum years",
      maximumYears: "Maximum years",
      currency: "Currency",
      salaryMin: "Minimum salary",
      salaryMax: "Maximum salary",
      salaryPeriod: "Salary period",
      preview: "Candidate preview",
      save: "Save",
      createDraft: "Create draft",
    },
    errors: {
      versionConflict:
        "This Opening changed. Its latest version has been loaded; review it and try again.",
      quota:
        "The Opening quota is full: {{count}} of {{quota}} slots are used.",
      invalidTeam:
        "These addresses are not active members of this organization: {{addresses}}.",
      invalidField: "Check this field.",
      incomplete:
        "This Opening is incomplete. Complete these fields and try again:",
      notEditable: "This Opening cannot be edited in its current state.",
      contentLocked:
        "Content is frozen while a publish or revise request is pending. Withdraw the request to edit it.",
    },
    historyActions: {
      created: "Created",
      duplicated: "Duplicated",
      working_copy_saved: "Working copy saved",
      team_changed: "Team changed",
      pipeline_changed: "Pipeline changed",
      revision_discarded: "Revision discarded",
      discarded: "Discarded",
      requested: "Requested",
      approved: "Approved",
      self_approved: "Approved by requester",
      rejected: "Rejected",
      withdrawn: "Withdrawn",
      superseded: "Superseded",
      cancelled: "Cancelled",
      expired: "Expired",
    },
  },
  applications: {
    removedApplicant: "Removed applicant",
    search: "Search by name",
    searchTooShort_one: "Type at least {{count}} character.",
    searchTooShort_other: "Type at least {{count}} characters.",
    clearFilters: "Clear filters",
    noMatches: "No applications match these filters.",
    applicantsIntro:
      "People who applied and are waiting for a first decision. Shortlist someone to move them into your pipeline as a candidate.",
    applicantsReadOnly:
      "People who applied and are waiting for a first decision. Only the hiring manager, the recruiter, and people with candidacy access can shortlist.",
    applicantsEmpty:
      "No one is waiting for a decision. New applications appear here.",
    candidatesEmpty:
      "No candidates yet. Shortlist an applicant to start the pipeline.",
    finishedEmpty: "No applications here.",
    stageCards: "Candidates by stage",
    allActive: "All active",
    active: "Active",
    viewWithCount: "{{state}} ({{count}})",
    noStage: "No stage",
    stateCaptions: {
      offered: "Waiting on candidate",
      offer_accepted: "Record joining",
    },
    states: {
      submitted: "Applied",
      in_pipeline: "In pipeline",
      offered: "Offered",
      offer_accepted: "Offer accepted",
      offer_declined: "Offer declined",
      joined: "Joined",
      did_not_join: "Did not join",
      not_progressing: "Not progressing",
      withdrawn: "Withdrawn",
    },
    stageKinds: {
      review: "Review",
      assessment: "Assessment",
      interview: "Interview",
      background_check: "Background check",
    },
    columns: {
      applicant: "Applicant",
      application: "Application",
      applied: "Applied",
      actions: "Actions",
      candidate: "Candidate",
      stage: "Stage",
      status: "Status",
      updated: "Updated",
    },
    pending: {
      label: "Waiting on candidate",
      interview_response: "Interview response",
      background_check_consent: "Background check consent",
      offer_response: "Offer response",
    },
    tabs: {
      applicants: "Applicants",
      candidates: "Candidates",
    },
    notFound: "This application was not found, or you cannot read it.",
    backToOpening: "Back to the Opening",
    detailTitle: "{{name}} | Vetchium",
    applicationNumber: "Application #{{number}}",
    appliedOn: "Applied {{date}}",
    coverNote: "Cover note",
    overHired:
      "{{joined}} people have joined against {{positions}} planned positions. Hiring more than planned is allowed.",
    errors: {
      versionConflict:
        "This application changed since you opened it. It was reloaded; check it and try again.",
      stateConflict:
        "The application's state no longer allows this action. It was reloaded.",
      notFound: "This application was not found, or you cannot read it.",
      permissionRequired:
        "Only the Opening's hiring manager, its recruiter, and people with candidacy access can do this.",
      invalidStage: "That stage is not available for this application.",
      invalidDate:
        "That date is not allowed. Check it against the offer and the other dates.",
    },
    shortlist: {
      action: "Shortlist",
      row: "Shortlist {{name}}",
      title: "Shortlist {{name}}",
      intro: "{{name}} becomes a candidate. Choose the stage to start at.",
      stage: "Stage",
      confirm: "Shortlist",
      done: "{{name}} is now a candidate.",
      seesInReview: "{{name}} sees “In review”. Stage names stay internal.",
      seesInterviewing:
        "{{name}} sees “Interviewing”. Stage names stay internal.",
    },
    notProgressing: {
      action: "Not progressing",
      row: "Mark {{name}} as not progressing",
      title: "Mark {{name}} as not progressing?",
      body: "{{name}} sees “Not progressing” in Vetchium and the application ends.",
      candidacy:
        "Upcoming interviews are cancelled and an extended offer is withdrawn.",
      final: "This cannot be undone.",
      confirm: "Not progressing",
      done: "{{name}} is marked as not progressing.",
    },
    actions: {
      title: "Actions",
      readOnly:
        "You can read this application but not act on it. Only the Opening's hiring manager, its recruiter, and people with candidacy access can.",
      none: "This application has ended, so there is nothing left to do.",
      moveLabel: "Move to a later stage",
      choosePlaceholder: "Choose stage",
      move: "Move",
      moved: "Moved to the new stage.",
      skipHelp: "Stages you pass over are marked skipped.",
      willSkip: "Skips: {{stages}}.",
      completeReview: "Mark review completed",
    },
    confirm: {
      "complete-stage": {
        action: "Mark review completed",
        title: "Mark review completed?",
        body: "This completes “{{stage}}”. Move the candidate on afterwards.",
        confirm: "Mark completed",
        done: "Review marked as completed.",
      },
      "did-not-join": {
        action: "Did not join",
        title: "Record that they did not join?",
        body: "The candidate accepted the offer but did not join. The application ends.",
        confirm: "Did not join",
        done: "Recorded as did not join.",
      },
    },
    dates: {
      saved: "Date saved.",
      joinedOn: "Joined on",
      separatedOn: "Separated on",
      utc: "Dates are UTC calendar dates.",
      overHiring:
        "{{joined}} of {{positions}} planned positions are already filled. Recording another person who joined hires more than planned; this is allowed.",
      "record-joined": {
        action: "Record joined",
        title: "Record joining date",
        help: "The day they started. Not in the future, and not before the offer was extended.",
        confirm: "Record joined",
      },
      "record-separated": {
        action: "Record separation",
        title: "Record separation date",
        help: "Optional fact: the day they left. After the joining date and within 365 days of it.",
        confirm: "Record separation",
      },
      "correct-joined": {
        action: "Correct joining date",
        title: "Correct joining date",
        help: "You can correct this within 90 days of first recording it. The history keeps every value.",
        confirm: "Save date",
      },
      "correct-separated": {
        action: "Correct separation date",
        title: "Correct separation date",
        help: "You can correct this within 90 days of first recording it. The history keeps every value.",
        confirm: "Save date",
      },
    },
    progress: {
      title: "Progress",
      completed: "Completed",
      skipped: "Skipped",
      current: "Current",
      offer: "Offer",
      accepted: "Accepted",
      joined: "Joined",
    },
    waiting: {
      title: "Waiting on candidate",
      interview: "Interview {{number}} on {{start}}",
      consent: "Consent for the background check at “{{stage}}”",
      offer: "Offer response due {{date}}",
    },
    snapshot: {
      title: "Profile at application",
      removed:
        "The retention period ended, so this applicant's data was deleted.",
      country: "Resident country",
      about: "About",
      work: "Work experience",
      education: "Education",
      certifications: "Certifications",
      languages: "Languages",
      websites: "Websites",
      present: "present",
      captured:
        "Captured on {{date}} when they applied. Later profile changes do not appear here.",
      abilities: {
        speaking: "speaking",
        reading: "reading",
        writing: "writing",
      },
    },
    history: {
      title: "History",
      more: "Show more",
      interview: "Interview {{number}}",
      actors: {
        applicant: "Applicant",
        org_user: "Org user",
        system: "System",
      },
      actions: {
        applied: "Applied",
        shortlisted: "Shortlisted",
        stage_moved: "Moved to a stage",
        offer_extended: "Offer extended",
        offer_withdrawn: "Offer withdrawn",
        offer_accepted: "Offer accepted",
        offer_declined: "Offer declined",
        joined: "Joined",
        did_not_join: "Did not join",
        not_progressing: "Marked not progressing",
        withdrawn: "Withdrawn by the applicant",
        stage_completed: "Stage completed",
        separated: "Separation recorded",
        joined_corrected: "Joining date corrected",
        separated_corrected: "Separation date corrected",
        interview_scheduled: "Interview scheduled",
        interview_changed: "Interview changed",
        interview_cancelled: "Interview cancelled",
        interview_completed: "Interview completed",
        interview_no_show: "Interview no-show",
        interview_accepted: "Interview accepted by the applicant",
        interview_reschedule_requested: "Applicant asked for another time",
        interview_feedback_submitted: "Interview feedback submitted",
        assessment_recorded: "Assessment result recorded",
        background_check_consent_requested:
          "Background check consent requested",
        background_check_consent_given: "Background check consent given",
        background_check_consent_declined: "Background check consent declined",
        background_check_result_recorded: "Background check result recorded",
        removed: "Applicant data removed",
      },
    },
    work: {
      interviews: "Interviews",
      interview: "Interview {{number}}",
      when: "When",
      whenValue: "{{start}} · {{minutes}} min",
      mode: "Mode",
      modes: {
        in_person: "In person",
      },
      interviewers: "Interviewers",
      interviewerSubmitted: "{{email}} (feedback submitted)",
      rescheduleNote: "The applicant asked for another time: “{{note}}”",
      feedbackBy: "{{email}}: {{recommendation}}",
      interviewStates: {
        scheduled: "Scheduled",
        completed: "Completed",
        no_show: "No-show",
        cancelled: "Cancelled",
      },
      responses: {
        pending: "Awaiting response",
        accepted: "Accepted",
        reschedule_requested: "Another time requested",
      },
      recommendations: {
        strong_yes: "Strong yes",
        yes: "Yes",
        no: "No",
        strong_no: "Strong no",
      },
      assessments: "Assessments",
      outcomes: {
        pass: "Pass",
        fail: "Fail",
        inconclusive: "Inconclusive",
      },
      score: "Score {{score}}",
      report: "Report",
      recorded: "Recorded {{date}} by {{by}}",
      backgroundChecks: "Background checks",
      consent: {
        requested: "Consent requested",
        given: "Consent given",
        declined: "Consent declined",
        ended: "Request ended",
      },
      checkTypes: {
        identity: "Identity",
        education: "Education",
        employment: "Employment",
        criminal: "Criminal record",
        address: "Address",
        credit: "Credit",
        drug: "Drug test",
      },
      checkOutcomes: {
        clear: "Clear",
        discrepancy: "Discrepancy",
        unable_to_verify: "Unable to verify",
      },
      checkPending: "Pending",
      resultsNotDecided:
        "Vetchium records results; it never decides what to do about them. That decision is yours.",
      offers: "Offers",
      offer: "Offer {{number}}",
      offerStates: {
        extended: "Extended",
        accepted: "Accepted",
        declined: "Declined",
        expired: "Expired",
        withdrawn: "Withdrawn",
      },
      letter: "Offer letter (PDF)",
      offerDates: "Extended {{extended}} · respond by {{respondBy}}",
      proposedJoining: "Proposed joining date: {{date}}",
    },
  },
  pipeline: {
    title: "Pipeline",
    internal: "Internal",
    startFrom: "Start from",
    startFromHelp:
      "The Opening gets its own copy. You can change its stages any time from the Opening's Pipeline tab.",
    defaultStart: "One review stage",
    templateOption: "{{name}} · {{count}} stages",
    templatesLoadError:
      "Your pipeline templates could not be loaded. The Opening will start with one review stage.",
    stages: "Stages",
    unsaved: "Unsaved changes",
    discard: "Discard",
    save: "Save pipeline",
    saved: "Pipeline saved.",
    intro:
      "Candidates move through these stages in order. The pipeline is internal: changes apply at once and never need approval. Candidates only see a general status, never stage names.",
    readOnly:
      "This Opening can no longer be changed, so its pipeline is read-only.",
    problems: {
      empty: "A pipeline needs at least one stage.",
      tooMany: "A pipeline has at most 15 stages.",
      name: "Give every stage a name of 1 to 100 characters.",
    },
    errors: {
      inUse:
        "Some stages you removed hold candidates, so the pipeline was not saved. Move those candidates to another stage, or restore the stages.",
      versionConflict:
        "This Opening changed since you opened it. Your edits are kept; save again to apply them to the latest version.",
      unavailable:
        "This Opening can no longer be changed, so the pipeline was not saved.",
      unknownStage:
        "A stage was removed elsewhere. Discard your changes to load the current pipeline.",
    },
    candidatesHere_one: "{{count}} candidate",
    candidatesHere_other: "{{count}} candidates",
    removeHoldsCandidates:
      "Removing “{{name}}” will be refused while it holds candidates. Move them to another stage first, or restore it.",
    removeRefused:
      "“{{name}}” cannot be removed because it holds a candidate. Move them to another stage first, or restore it.",
    afterLast: "After the last stage:",
    after: {
      offer: "Offer",
      offerAccepted: "Offer accepted",
      joined: "Joined",
    },
    offerAnywhere: "You can extend an offer from any stage.",
    stageName: "Stage {{number}} name",
    stageNameRemoved: "Name of removed stage {{name}}",
    stageNamePlaceholder: "Stage name",
    stageKind: "Stage {{number}} kind",
    stageKindRemoved: "Kind of removed stage {{name}}",
    moveUp: "Move stage {{number}} up",
    moveDown: "Move stage {{number}} down",
    remove: "Remove stage {{number}}",
    restore: "Restore",
    restoreStage: "Restore stage {{name}}",
    addStage: "Add stage",
    limitReached: "The most a pipeline can have is {{limit}} stages.",
    stageCount: "{{count}} of {{limit}} stages",
    minimumStage: "A pipeline needs at least one stage.",
    kinds: {
      review: "Review",
      assessment: "Assessment",
      interview: "Interview",
      background_check: "Background check",
    },
    actions: "Actions",
    template: {
      documentTitle: "Pipeline templates | Vetchium",
      title: "Pipeline templates",
      intro:
        "Saved stage lists for new Openings. A new Opening copies a template; editing a template later never changes Openings that used it.",
      new: "New template",
      newTitle: "New template",
      editTitle: "Edit template",
      name: "Name",
      nameHelp: "Unique in your organization.",
      nameRequired: "Enter a template name of 1 to 100 characters.",
      stageNameRequired: "Give every stage a name of 1 to 100 characters.",
      nameTaken: "Another template already has this name.",
      limit:
        "Your organization already has the most templates it can keep ({{limit}}). Delete one to add another.",
      gone: "This template no longer exists. Reload the page.",
      stagesHelp:
        "1 to 15 stages, in order. Review stages are always done in-house; others can go to providers.",
      save: "Save template",
      saved: "Template “{{name}}” saved.",
      deleteTitle: "Delete “{{name}}”?",
      deleteBody:
        "Openings that were started from this template keep their stages.",
      delete: "Delete",
      deleted: "Template “{{name}}” deleted.",
      edit: "Edit",
      editNamed: "Edit template {{name}}",
      deleteNamed: "Delete template {{name}}",
      updated: "Updated",
      search: "Search name",
      count: "{{count}} of {{limit}} templates",
      empty:
        "No pipeline templates yet. Create one to start new Openings with the same stages.",
      noMatch: "No template matches this search.",
    },
  },
} as const;
type TranslationShape<Resource> = {
  readonly [Key in keyof Resource]: Resource[Key] extends string
    ? string
    : TranslationShape<Resource[Key]>;
};

export type LocaleResource = TranslationShape<typeof en>;
