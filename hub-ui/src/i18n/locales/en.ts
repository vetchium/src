export const en = {
  shell: {
    documentTitle: "Vetchium",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium home",
    footer: "Vetchium",
    logout: "Sign out",
    operationInProgress:
      "Finish the operation in progress before leaving this page.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Open navigation",
    home: "Home",
    profile: "My profile",
    security: "Security",
  },
  theme: {
    toggleLabel: "Switch light or dark mode",
  },
  language: {
    selectorLabel: "Select language",
  },
  languages: {
    "en-US": "English US",
    ta: "தமிழ்",
    "de-DE": "Deutsch",
  },
  languageShort: {
    "en-US": "EN",
    ta: "TA",
    "de-DE": "DE",
  },
  fields: {
    email: "Email address",
    password: "Password",
    displayName: "Display name",
    language: "Language",
    residentCountry: "Resident country",
    newPassword: "New password",
    confirmPassword: "Confirm password",
    currentPassword: "Current password",
    totpCode: "Authenticator code",
    recoveryCode: "Recovery code",
    handle: "Handle",
    did: "Profile ID",
    twoFactor: "Two-factor authentication",
    recoveryCodes: "Recovery codes remaining",
  },
  login: {
    documentTitle: "Sign in | Vetchium",
    title: "Sign in",
    description: "Use your Vetchium account.",
    action: "Sign in",
    rememberMe: "Remember me on this device",
    tfaDescription: "Enter the code from your authenticator app.",
    verify: "Verify and sign in",
    useRecoveryCode: "Use a recovery code instead",
    useAuthenticator: "Use an authenticator code instead",
    forgotPassword: "Forgot your password?",
    noAccount: "New to Vetchium?",
    signup: "Create an account",
  },
  twoFactor: {
    documentTitle: "Two-factor verification | Vetchium",
    title: "Verify your identity",
    description: "Enter a code from your authenticator or use a recovery code.",
    authenticator: "Authenticator",
    recovery: "Recovery code",
    action: "Verify and sign in",
    restart: "Start sign in again",
  },
  signup: {
    documentTitle: "Create account | Vetchium",
    title: "Create your account",
    description:
      "Choose your language and resident country. We will email your signup link in the selected language.",
    action: "Email my signup link",
    checkEmail:
      "Check your inbox. If the address is eligible, your signup link is on its way.",
    haveAccount: "Already have an account?",
    signin: "Sign in",
  },
  completeSignup: {
    documentTitle: "Complete signup | Vetchium",
    title: "Choose your password",
    action: "Complete signup",
    success: "Your account is ready. Your handle is {{handle}}.",
  },
  forgotPassword: {
    documentTitle: "Forgot password | Vetchium",
    title: "Reset your password",
    description: "Enter your account email address.",
    action: "Email a reset link",
    checkEmail:
      "If an account exists for that address, a password reset link is on its way.",
  },
  resetPassword: {
    documentTitle: "Choose a new password | Vetchium",
    title: "Choose a new password",
    action: "Reset password",
    success:
      "Your password has been reset. All previous sessions were signed out.",
  },
  common: {
    backToSignin: "Back to sign in",
    continueToSignin: "Continue to sign in",
    cancel: "Cancel",
    confirm: "Confirm",
    disabled: "Disabled",
    enabled: "Enabled",
    loadError: "We could not load this information.",
    retry: "Try again",
  },
  validation: {
    required: "This field is required.",
    email: "Enter a valid email address.",
    displayName: "Enter a display name of no more than 200 characters.",
    country: "Choose your resident country.",
    newPassword: "Use 15 to 128 characters and avoid commonly used passwords.",
    passwordMatch: "The passwords do not match.",
    totp: "Enter the six-digit authenticator code.",
    recoveryCode: "Enter a valid recovery code.",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    invalidCredentials: "The email address or password is incorrect.",
    signupDomainNotAllowed:
      "This Vetchium tenant does not allow signup with that email domain.",
    invalidSignupToken: "This signup link is invalid or has expired.",
    invalidResetToken: "This password reset link is invalid or has expired.",
    incorrectPassword: "The current password is incorrect.",
    incorrectTOTP: "That authenticator code is incorrect.",
    incorrectRecoveryCode:
      "That recovery code is incorrect or has already been used.",
    expiredLoginChallenge: "The sign-in attempt expired. Please start again.",
    recentAuthenticationRequired:
      "Enter your password again before continuing.",
    rateLimited: "Too many attempts. Please wait and try again.",
    idempotencyConflict:
      "This action was already submitted with different details. Reload the page and try again.",
    totpAlreadyEnabled: "Two-factor authentication is already enabled.",
    totpNotEnabled: "Two-factor authentication is not enabled.",
    invalidEnrollment: "This authenticator setup expired. Start again.",
  },
  profile: {
    documentTitle: "My profile | Vetchium",
    title: "My profile",
    description: "Review your identity and choose your account preferences.",
    identity: "Account identity",
    preferences: "Preferences",
    saved: "Your preference was saved.",
  },
  security: {
    documentTitle: "Security | Vetchium",
    title: "Security",
    description: "Manage your password and two-factor authentication.",
  },
  reauthentication: {
    documentTitle: "Confirm your identity | Vetchium",
    title: "Confirm your identity",
    description: "Sign in again before changing sensitive security settings.",
    action: "Sign in again",
    pageTitle: "Confirm your password",
    pageDescription: "This keeps sensitive account changes protected.",
    account: "Signed in as {{email}}",
    confirm: "Confirm password",
    error: "The password was not accepted.",
  },
  passwordChange: {
    title: "Change password",
    description:
      "Changing your password signs out every other browser and preserves this session.",
    action: "Change password",
    success: "Your password was changed and other sessions were signed out.",
  },
  tfa: {
    title: "Two-factor authentication",
    description:
      "Use an authenticator app for an additional verification step when signing in.",
    enable: "Set up authenticator",
    confirm: "Confirm authenticator",
    disable: "Disable authenticator",
    disabled: "Two-factor authentication was disabled.",
    enabled: "Two-factor authentication was enabled.",
    regenerated: "New recovery codes were issued.",
    regenerate: "Replace recovery codes",
    regenerateConfirm: "Replace every existing recovery code?",
    disableConfirm: "Disable two-factor authentication?",
    disableWarning:
      "Authenticator and recovery-code verification will no longer be required at sign in.",
    enrollmentInstructions:
      "Add this key to your authenticator app, then enter its six-digit code.",
    qrLabel: "Authenticator setup QR code",
    manualKey: "Manual entry key",
    algorithm: "Algorithm",
    digits: "Digits",
    period: "Refresh interval",
    seconds: "{{seconds}} seconds",
    expires: "Setup expires",
  },
  recoveryCodes: {
    title: "Recovery codes",
    warning: "Save these recovery codes now.",
    description:
      "Each code works once. Existing recovery codes have been replaced and cannot be shown again.",
    copyAll: "Copy all recovery codes",
    saved: "I saved these codes",
  },
  notFound: {
    title: "Page not found",
    description: "The page you requested does not exist.",
    action: "Go to home",
  },
  home: {
    documentTitle: "Home | Vetchium",
    placeholder: "Vetchium home page",
  },
} as const;

type TranslationShape<Resource> = {
  readonly [Key in keyof Resource]: Resource[Key] extends string
    ? string
    : TranslationShape<Resource[Key]>;
};

export type LocaleResource = TranslationShape<typeof en>;
