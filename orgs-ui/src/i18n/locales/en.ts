export const en = {
  shell: {
    documentTitle: "Vetchium for organizations",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium for organizations home",
    footer: "Vetchium for organizations",
    logout: "Sign out",
    operationInProgress: "Finish the operation in progress before leaving.",
    signedInAs: "Signed in as",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Open navigation",
    home: "Home",
    members: "Members",
    security: "Security",
    restoreDomain: "Restore domain",
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
    password: "Password",
    permissions: "Permissions",
    recoveryCode: "Recovery code",
    releaseAfter: "Released after",
    totpCode: "Six-digit code",
    workEmail: "Work email address",
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
    workEmail:
      "Enter an email address at your organization's own domain, such as name@example.com.",
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
      "Addresses at public email providers cannot sign an organization up. Use an address at your organization's own domain.",
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
    userDisabledNonpayment:
      "Your account was disabled because your organization's subscription was not paid. Contact your organization's administrator.",
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
    permissionRequired: "Only a superadmin of your organization can do this.",
    recentAuthenticationRequired: "Sign in again to continue.",
    totpAlreadyEnabled: "Two-factor authentication is already on.",
    totpNotEnabled: "Two-factor authentication is off.",
    invalidEnrollment: "This setup has expired. Start it again.",
  },
  signup: {
    regionDescription:
      "Choose where your organization's data is kept. Pick the country your organization mainly operates in to see the recommended region.",
    country: "Country",
    language: "Language",
    regionLabel: "Region",
    recommendedRegion: "{{region}} ({{tenant}}), recommended",
    regionOption: "{{region}} ({{tenant}})",
    continueRegion: "Continue in {{region}} ({{tenant}})",
    continue: "Continue",
    noRegions: "No region accepts organization signups right now.",
    hosting: "Your organization will be kept in {{region}} ({{tenant}}).",
    changeRegion: "Choose another region",
    documentTitle: "Sign up | Vetchium for organizations",
    title: "Sign up your organization",
    description:
      "Your organization is identified by its domain. To prove that it controls the domain, you publish a DNS record we send you.",
    requester:
      "Whoever manages the domain for the organization, usually IT staff, should do this. The person who completes signup becomes the organization's first superadmin.",
    emailHelp:
      "Use your address at the domain the organization will sign up with.",
    derivedDomain: "Domain to sign up: {{domain}}",
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
      again: "Use a different email address",
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
    action: "Verify domain and create organization",
    pending:
      "The domain is verified and the organization is being created. This page checks again automatically.",
    stillPending:
      "The organization is still being created. Check again in a few minutes.",
    checkAgain: "Check again",
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
    accountCard: "Your account",
    noPermissions: "No permissions",
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
        "Invite, disable and re-enable users, and change what they can do, except the superadmin and billing permissions.",
    },
    "org:manage_billing": {
      name: "MANAGE_BILLING",
      description:
        "Choose the organization's plan, pay for it, and review invoices.",
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
    documentTitle: "Security | Vetchium for organizations",
    title: "Security",
    description: "Sign-in settings for {{email}}.",
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
  roles: {
    superadmin: "Superadmin",
    finance: "Finance",
    userManager: "User manager",
    member: "Member",
    custom: "Custom",
  },
  users: {
    documentTitle: "Members | Vetchium for organizations",
    title: "Members",
    description:
      "Invite people, choose what each can do, and turn accounts off when they leave.",
    tabs: { members: "Members", invitations: "Invitations" },
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
      disabledNonpayment: "Disabled, unpaid subscription",
    },
    filters: { state: "State", role: "Role" },
    filterState: {
      active: "Active",
      "disabled-manual": "Disabled",
      "disabled-nonpayment": "Disabled, unpaid subscription",
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
        "disabled-nonpayment": "{{count}} unpaid",
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
} as const;

type TranslationShape<Resource> = {
  readonly [Key in keyof Resource]: Resource[Key] extends string
    ? string
    : TranslationShape<Resource[Key]>;
};

export type LocaleResource = TranslationShape<typeof en>;
