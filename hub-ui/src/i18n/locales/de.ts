export const de = {
  shell: {
    documentTitle: "Vetchium",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium-Startseite",
    footer: "Vetchium",
    logout: "Abmelden",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Navigation öffnen",
    home: "Startseite",
    settings: "Einstellungen",
  },
  theme: {
    toggleLabel: "Zwischen hellem und dunklem Modus wechseln",
  },
  language: {
    selectorLabel: "Sprache auswählen",
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
    email: "E-Mail-Adresse",
    password: "Passwort",
    displayName: "Anzeigename",
    language: "Sprache",
    residentCountry: "Wohnsitzland",
    newPassword: "Neues Passwort",
    confirmPassword: "Passwort bestätigen",
    currentPassword: "Aktuelles Passwort",
    totpCode: "Authenticator-Code",
    recoveryCode: "Wiederherstellungscode",
    handle: "Handle",
    did: "Profil-ID",
  },
  login: {
    documentTitle: "Anmelden | Vetchium",
    title: "Anmelden",
    description: "Verwenden Sie Ihr Vetchium-Konto.",
    action: "Anmelden",
    rememberMe: "Auf diesem Gerät angemeldet bleiben",
    tfaDescription: "Geben Sie den Code aus Ihrer Authenticator-App ein.",
    verify: "Prüfen und anmelden",
    useRecoveryCode: "Stattdessen Wiederherstellungscode verwenden",
    useAuthenticator: "Stattdessen Authenticator-Code verwenden",
    forgotPassword: "Passwort vergessen?",
    noAccount: "Neu bei Vetchium?",
    signup: "Konto erstellen",
  },
  signup: {
    documentTitle: "Konto erstellen | Vetchium",
    title: "Erstellen Sie Ihr Konto",
    description:
      "Wählen Sie Sprache und Wohnsitzland. Der Registrierungslink wird in der gewählten Sprache gesendet.",
    action: "Registrierungslink senden",
    checkEmail:
      "Prüfen Sie Ihren Posteingang. Wenn die Adresse berechtigt ist, wird der Registrierungslink gesendet.",
    haveAccount: "Sie haben bereits ein Konto?",
    signin: "Anmelden",
  },
  completeSignup: {
    documentTitle: "Registrierung abschließen | Vetchium",
    title: "Passwort wählen",
    action: "Registrierung abschließen",
    success: "Ihr Konto ist bereit. Ihr Handle lautet {{handle}}.",
  },
  forgotPassword: {
    documentTitle: "Passwort vergessen | Vetchium",
    title: "Passwort zurücksetzen",
    description: "Geben Sie die E-Mail-Adresse Ihres Kontos ein.",
    action: "Link zum Zurücksetzen senden",
    checkEmail:
      "Wenn für diese Adresse ein Konto besteht, wird ein Link zum Zurücksetzen gesendet.",
  },
  resetPassword: {
    documentTitle: "Neues Passwort wählen | Vetchium",
    title: "Neues Passwort wählen",
    action: "Passwort zurücksetzen",
    success:
      "Ihr Passwort wurde zurückgesetzt. Alle bisherigen Sitzungen wurden abgemeldet.",
  },
  common: {
    backToSignin: "Zurück zur Anmeldung",
    continueToSignin: "Weiter zur Anmeldung",
  },
  validation: {
    required: "Dieses Feld ist erforderlich.",
    email: "Geben Sie eine gültige E-Mail-Adresse ein.",
    displayName: "Geben Sie einen Anzeigenamen mit höchstens 200 Zeichen ein.",
    country: "Wählen Sie Ihr Wohnsitzland.",
    newPassword:
      "Verwenden Sie 15 bis 128 Zeichen und vermeiden Sie häufige Passwörter.",
    passwordMatch: "Die Passwörter stimmen nicht überein.",
    totp: "Geben Sie den sechsstelligen Authenticator-Code ein.",
  },
  errors: {
    generic: "Ein Fehler ist aufgetreten. Versuchen Sie es erneut.",
    invalidCredentials: "E-Mail-Adresse oder Passwort ist falsch.",
    signupDomainNotAllowed:
      "Dieser Vetchium-Mandant erlaubt keine Registrierung mit dieser E-Mail-Domain.",
    invalidSignupToken:
      "Dieser Registrierungslink ist ungültig oder abgelaufen.",
    invalidResetToken:
      "Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen.",
    incorrectPassword: "Das aktuelle Passwort ist falsch.",
    incorrectTOTP: "Dieser Authenticator-Code ist falsch.",
    incorrectRecoveryCode:
      "Dieser Wiederherstellungscode ist falsch oder wurde bereits verwendet.",
    expiredLoginChallenge:
      "Der Anmeldeversuch ist abgelaufen. Beginnen Sie erneut.",
    recentAuthenticationRequired: "Geben Sie Ihr Passwort erneut ein.",
    rateLimited: "Zu viele Versuche. Warten Sie und versuchen Sie es erneut.",
  },
  settings: {
    documentTitle: "Einstellungen | Vetchium",
    title: "Einstellungen",
    saved: "Ihre Einstellung wurde gespeichert.",
  },
  profile: {
    title: "Profileinstellungen",
  },
  passwordChange: {
    title: "Passwort ändern",
    description:
      "Durch die Passwortänderung werden alle anderen Browser abgemeldet; diese Sitzung bleibt bestehen.",
    action: "Passwort ändern",
    success:
      "Ihr Passwort wurde geändert und andere Sitzungen wurden abgemeldet.",
  },
  tfa: {
    title: "Zwei-Faktor-Authentifizierung",
    description:
      "Verwenden Sie beim Anmelden eine Authenticator-App als zusätzliche Prüfung.",
    enable: "Authenticator einrichten",
    confirm: "Authenticator bestätigen",
    disable: "Authenticator deaktivieren",
    disabled: "Die Zwei-Faktor-Authentifizierung wurde deaktiviert.",
    regenerate: "Wiederherstellungscodes ersetzen",
    enrollmentInstructions:
      "Fügen Sie diesen Schlüssel Ihrer Authenticator-App hinzu und geben Sie danach den sechsstelligen Code ein.",
    saveRecoveryCodes:
      "Speichern Sie diese Wiederherstellungscodes jetzt. Jeder Code kann nur einmal verwendet werden.",
    remaining: "Verbleibende Wiederherstellungscodes: {{count}}",
  },
  home: {
    documentTitle: "Startseite | Vetchium",
    placeholder: "Vetchium-Startseite",
  },
} as const;
