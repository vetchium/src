export const en = {
  shell: {
    documentTitle: "Vetchium Admin",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium admin home",
    portal: "Admin",
    footer: "Vetchium tenant administration",
    logout: "Sign out",
    operationInProgress:
      "Finish the operation in progress before leaving this page.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Open navigation",
    overview: "Overview",
    users: "Administrators",
    hubSignupDomains: "Hub signup domains",
    profile: "My profile",
    security: "Security",
  },
  theme: {
    dark: "Dark",
    light: "Light",
    toggleLabel: "Switch light or dark mode",
  },
  language: {
    changeError: "The language could not be changed. Please try again.",
    selectorLabel: "Select language",
  },
  languageShort: {
    "en-US": "EN",
    ta: "TA",
    de_DE: "DE",
  },
  common: {
    all: "All",
    backToLogin: "Back to sign in",
    cancel: "Cancel",
    close: "Close",
    confirm: "Confirm",
    disabled: "Disabled",
    enabled: "Enabled",
    idempotencyConflict:
      "This action was already submitted with different details. Reload the page and try again.",
    loadError: "We could not load this information.",
    next: "Next",
    never: "Never",
    notApplicable: "Not applicable",
    notEnabled: "Not enabled",
    previous: "Previous",
    remove: "Remove",
    requestError: "The request could not be completed. Please try again.",
    retry: "Try again",
    search: "Search",
    save: "Save changes",
  },
  fields: {
    administrator: "Administrator",
    access: "Access",
    accountType: "Account type",
    actions: "Actions",
    confirmPassword: "Confirm password",
    email: "Email address",
    domain: "Domain",
    language: "Language",
    lastLogin: "Last sign in",
    name: "Name",
    newPassword: "New password",
    password: "Password",
    granted: "Granted",
    permission: "Permission",
    recoveryCode: "Recovery code",
    recoveryCodes: "Recovery codes remaining",
    sessionExpires: "Session expires",
    state: "State",
    tenant: "Tenant",
    totpCode: "Six-digit code",
    twoFactor: "Two-factor authentication",
    updated: "Updated",
  },
  validation: {
    displayName: "Use a name between 1 and 200 characters.",
    email: "Enter a valid email address.",
    domain:
      "Enter an exact domain such as example.com, without an email address, wildcard, or URL.",
    disableComment: "Enter a comment between 1 and 500 characters.",
    newPassword:
      "Use 15 to 128 characters and avoid commonly used password phrases.",
    passwordMatch: "The passwords do not match.",
    recoveryCode: "Enter a valid recovery code.",
    required: "This field is required.",
    totpCode: "Enter the six-digit code.",
  },
  languages: {
    "en-US": "English US",
    ta: "தமிழ்",
    de_DE: "Deutsch",
  },
  states: { active: "Active", disabled: "Disabled" },
  permissions: {
    "admin:view_users": {
      name: "VIEW_ADMINISTRATORS",
      description:
        "Review administrator accounts, their access and their security status.",
    },
    "admin:manage_users": {
      name: "MANAGE_ADMINISTRATORS",
      description:
        "Invite administrators, enable or disable them, and change what they can do.",
    },
    "admin:view_hub_signup_domains": {
      name: "VIEW_HUB_SIGNUP_DOMAINS",
      description:
        "Review the corporate email domains accepted for new Hub user signups.",
    },
    "admin:manage_hub_signup_domains": {
      name: "MANAGE_HUB_SIGNUP_DOMAINS",
      description:
        "Add, edit, disable, and reactivate corporate email domains accepted for new Hub user signups.",
    },
    unknown: {
      description:
        "This permission was added after this portal was built. It is kept as it is unless you turn it off.",
    },
    includedBy: "Included by {{permission}}",
  },
  login: {
    documentTitle: "Sign in | Vetchium Admin",
    title: "Sign in",
    description: "Use your tenant administrator account.",
    action: "Sign in",
    error: "The email address or password was not accepted.",
    forgotPassword: "Forgot your password?",
  },
  twoFactor: {
    documentTitle: "Two-factor verification | Vetchium Admin",
    title: "Verify your identity",
    description: "Enter a code from your authenticator or use a recovery code.",
    authenticator: "Authenticator",
    recovery: "Recovery code",
    action: "Verify",
    error: "The code was not accepted or the login attempt expired.",
    restart: "Start sign in again",
  },
  forgotPassword: {
    documentTitle: "Reset password | Vetchium Admin",
    title: "Forgot your password?",
    description:
      "Enter your email address. If it is eligible, we will send reset instructions.",
    action: "Send reset instructions",
    success: "If the account is eligible, reset instructions have been sent.",
  },
  resetPassword: {
    documentTitle: "Choose a new password | Vetchium Admin",
    title: "Choose a new password",
    missingToken: "This password-reset link is incomplete.",
    success: "Your password has been changed. You can now sign in.",
    error: "This reset link is invalid or expired.",
    action: "Change password",
  },
  completeSetup: {
    documentTitle: "Complete account setup | Vetchium Admin",
    title: "Complete your account setup",
    description:
      "Choose your profile preferences and create a secure password.",
    missingToken: "This invitation link is incomplete.",
    success: "Your administrator account is ready.",
    error: "This invitation is invalid, expired, or has already been used.",
    action: "Create account",
    signIn: "Continue to sign in",
  },
  home: {
    title: "Welcome, {{name}}",
    description: "Your administrator account and current tenant session.",
    accountCard: "Account overview",
    noPermissions: "No administrative permissions",
  },
  users: {
    title: "Administrators",
    description:
      "Manage who can administer this tenant and review account security.",
    searchPlaceholder: "Search by name or email address",
    statusFilter: "Account status",
    needsAttention: "Needs attention",
    clearFilters: "Clear filters",
    actionsFor: "Actions for {{name}}",
    page: "Page {{page}}",
    filters: {
      permissions: "Permissions",
      activity: "Sign-in activity",
    },
    quickFilters: {
      noTwoFactor: "No two-factor authentication",
      neverSignedIn: "Never signed in",
      dormant: "Dormant for 90 days",
      noAccess: "No assigned access",
    },
    activity: {
      never: "Never signed in",
      inactive30: "Inactive for 30 days",
      inactive90: "Inactive for 90 days",
    },
    empty: {
      default: "No administrators have been added yet.",
      filtered: "No administrators match these filters.",
    },
    invite: {
      action: "Invite administrator",
      title: "Invite an administrator",
      permissions: "Initial permissions",
      permissionsHint:
        "The invited administrator starts with the permissions granted here.",
      sent: "Invitation sent to {{email}}. It expires on {{expiresAt}}.",
      errors: {
        alreadyExists: "An administrator already uses that email address.",
        alreadyPending: "An invitation for that email address is still open.",
      },
    },
    disable: {
      action: "Disable",
      confirm: "Disable this administrator?",
      effect:
        "They will be signed out immediately and will not be able to sign in again until enabled.",
      done: "The administrator is now disabled.",
    },
    enable: {
      action: "Enable",
      confirm: "Enable this administrator?",
      effect: "They will be able to sign in again with their existing access.",
      done: "The administrator is now active.",
    },
    access: {
      action: "Manage access",
      title: "Manage access",
      none: "No assigned access",
      choosePermissions: "Choose permissions",
      choosePermissionsHint:
        "Changes take effect on the administrator's next request. A permission another one already includes cannot be turned off on its own.",
      saved: "Administrator access updated.",
      selfWarning: "You are changing your own access",
      selfWarningDetail:
        "Removing a permission from yourself takes effect immediately and another administrator has to grant it back.",
    },
    errors: {
      notFound: "That administrator no longer exists.",
      cannotDisableSelf: "You cannot disable your own account.",
      lastManager:
        "At least one active administrator has to keep the permission to manage administrators.",
    },
  },
  hubSignupDomains: {
    title: "Hub signup domains",
    description:
      "Control which exact corporate email domains this tenant will accept when Hub signup is enabled.",
    searchPlaceholder: "Search domains",
    stateFilter: "Domain state",
    page: "Page {{page}}",
    scope: {
      title: "This controls future signups only",
      description:
        "Changing this list does not disable existing Hub users. Mailbox verification and Hub signup will be implemented separately.",
    },
    empty: {
      default: "No Hub signup domains have been added yet.",
      filtered: "No Hub signup domains match these filters.",
    },
    form: {
      domainHint:
        "Use an exact corporate domain. Wildcards, URLs, email addresses, IP addresses, and Unicode input are not accepted. Use Punycode for an internationalized domain.",
      domainPlaceholder: "example.com",
      disabledCommentLabel: "Disable comment",
      disabledCommentHint:
        "Explain why this domain is being disabled. The comment is required and visible to domain administrators.",
    },
    create: {
      action: "Add domain",
      title: "Add a Hub signup domain",
      done: "Hub signup domain added.",
    },
    edit: {
      title: "Edit Hub signup domain",
      for: "Edit {{domain}}",
      done: "Hub signup domain updated.",
    },
    errors: {
      alreadyExists: "That domain is already in this tenant's allowlist.",
      notFound: "That domain entry no longer exists. Reload and try again.",
    },
  },
  profile: {
    title: "My profile",
    description: "Manage how your name appears in the admin portal.",
    nameCard: "Name",
    nameHint:
      "Enter the name you use professionally. You can use any language or writing system.",
    saved: "Profile updated.",
    saveError:
      "Your profile could not be updated. Check the values and try again.",
  },
  reauthentication: {
    title: "Sign in again to continue",
    description:
      "This action needs a sign in from the last five minutes. Sign in again and retry.",
    action: "Sign in again",
    documentTitle: "Confirm access | Vetchium Admin",
    pageTitle: "Confirm access",
    pageDescription:
      "Re-enter your password to continue to this sensitive page. Your current session remains active if you cancel.",
    account: "Signed in as {{email}}",
    confirm: "Confirm access",
    cancel: "Cancel",
    error: "That password was not accepted. Try again.",
  },
  security: {
    title: "Security",
    description:
      "Manage your password and two-factor authentication for this tenant.",
    password: {
      card: "Password",
      description:
        "Changing your password signs out every other session on this account.",
      action: "Change password",
      changed: "Your password has been changed.",
    },
    twoFactor: {
      card: "Two-factor authentication",
      description:
        "An authenticator app produces a six-digit code that is required at every sign in.",
      start: "Set up authenticator",
      scan: "Scan this code with your authenticator app.",
      qrLabel: "Authenticator enrolment code",
      manualKey: "Manual entry key",
      algorithm: "Algorithm",
      digits: "Digits",
      period: "Code interval",
      seconds: "{{seconds}} seconds",
      enrollmentExpires: "Setup expires",
      confirm: "Confirm and enable",
      disable: "Turn off two-factor authentication",
      disableConfirm: "Turn off two-factor authentication?",
      disableWarning:
        "Your account will be protected by the password alone, and every other session is signed out.",
      enabled: "Two-factor authentication is now enabled.",
      disabled: "Two-factor authentication is now disabled.",
      errors: {
        alreadyEnabled:
          "Two-factor authentication is already enabled for this account.",
        incorrectCode: "That code did not match. Try the next one.",
        invalidEnrollment: "This setup expired. Start it again.",
        notEnabled:
          "Two-factor authentication must be enabled before recovery codes can be issued.",
      },
    },
    recoveryCodes: {
      title: "Recovery codes",
      warning: "Save these codes now.",
      description:
        "Each code signs you in once if you lose your authenticator. They are shown only this once, and any earlier codes no longer work.",
      copyAll: "Copy every code",
      saved: "I have saved these codes",
      regenerate: "Regenerate recovery codes",
      regenerateConfirm:
        "Replace your recovery codes? The current codes stop working.",
      regenerated: "New recovery codes have been issued.",
    },
  },
  notFound: {
    title: "404",
    description: "The page you requested is not available.",
    action: "Return home",
  },
} as const;
