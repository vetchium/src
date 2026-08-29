import type { LocaleResource } from "./en";

export const de = {
  shell: {
    documentTitle: "Vetchium",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Vetchium-Startseite",
    footer: "Vetchium",
    logout: "Abmelden",
    operationInProgress:
      "Schließen Sie den laufenden Vorgang ab, bevor Sie diese Seite verlassen.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Navigation öffnen",
    home: "Startseite",
    profile: "Mein Profil",
    security: "Sicherheit",
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
    twoFactor: "Zwei-Faktor-Authentifizierung",
    recoveryCodes: "Verbleibende Wiederherstellungscodes",
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
  twoFactor: {
    documentTitle: "Zwei-Faktor-Prüfung | Vetchium",
    title: "Identität bestätigen",
    description:
      "Geben Sie einen Authenticator-Code oder einen Wiederherstellungscode ein.",
    authenticator: "Authenticator",
    recovery: "Wiederherstellungscode",
    action: "Prüfen und anmelden",
    restart: "Anmeldung neu starten",
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
    missingToken: "Dieser Registrierungslink ist unvollständig.",
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
    missingToken:
      "Dieser Link zum Zurücksetzen des Passworts ist unvollständig.",
    title: "Neues Passwort wählen",
    action: "Passwort zurücksetzen",
    success:
      "Ihr Passwort wurde zurückgesetzt. Alle bisherigen Sitzungen wurden abgemeldet.",
  },
  common: {
    backToSignin: "Zurück zur Anmeldung",
    continueToSignin: "Weiter zur Anmeldung",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    disabled: "Deaktiviert",
    enabled: "Aktiviert",
    loadError: "Diese Informationen konnten nicht geladen werden.",
    retry: "Erneut versuchen",
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
    recoveryCode: "Geben Sie einen gültigen Wiederherstellungscode ein.",
  },
  errors: {
    generic: "Ein Fehler ist aufgetreten. Versuchen Sie es erneut.",
    invalidCredentials: "E-Mail-Adresse oder Passwort ist falsch.",
    userDisabled:
      "Dieses Konto wurde deaktiviert. Wenden Sie sich an Ihre Vetchium-Administration.",
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
    idempotencyConflict:
      "Diese Aktion wurde bereits mit anderen Angaben gesendet. Laden Sie die Seite neu und versuchen Sie es erneut.",
    totpAlreadyEnabled:
      "Die Zwei-Faktor-Authentifizierung ist bereits aktiviert.",
    totpNotEnabled: "Die Zwei-Faktor-Authentifizierung ist nicht aktiviert.",
    invalidEnrollment: "Diese Einrichtung ist abgelaufen. Beginnen Sie erneut.",
  },
  profile: {
    documentTitle: "Mein Profil | Vetchium",
    title: "Mein Profil",
    description: "Prüfen Sie Ihre Identität und wählen Sie Ihre Einstellungen.",
    identity: "Kontoidentität",
    preferences: "Einstellungen",
    saved: "Ihre Einstellung wurde gespeichert.",
  },
  security: {
    documentTitle: "Sicherheit | Vetchium",
    title: "Sicherheit",
    description: "Verwalten Sie Passwort und Zwei-Faktor-Authentifizierung.",
  },
  reauthentication: {
    documentTitle: "Identität bestätigen | Vetchium",
    title: "Identität bestätigen",
    description: "Melden Sie sich vor sensiblen Änderungen erneut an.",
    action: "Erneut anmelden",
    pageTitle: "Passwort bestätigen",
    pageDescription: "Dies schützt sensible Kontoänderungen.",
    account: "Angemeldet als {{email}}",
    confirm: "Passwort bestätigen",
    error: "Das Passwort wurde nicht akzeptiert.",
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
    enabled: "Die Zwei-Faktor-Authentifizierung wurde aktiviert.",
    regenerated: "Neue Wiederherstellungscodes wurden erstellt.",
    regenerate: "Wiederherstellungscodes ersetzen",
    regenerateConfirm: "Alle vorhandenen Wiederherstellungscodes ersetzen?",
    disableConfirm: "Zwei-Faktor-Authentifizierung deaktivieren?",
    disableWarning:
      "Authenticator- und Wiederherstellungscodes werden bei der Anmeldung nicht mehr verlangt.",
    enrollmentInstructions:
      "Fügen Sie diesen Schlüssel Ihrer Authenticator-App hinzu und geben Sie danach den sechsstelligen Code ein.",
    qrLabel: "QR-Code zur Authenticator-Einrichtung",
    manualKey: "Schlüssel zur manuellen Eingabe",
    algorithm: "Algorithmus",
    digits: "Stellen",
    period: "Aktualisierungsintervall",
    seconds: "{{seconds}} Sekunden",
    expires: "Einrichtung läuft ab",
  },
  recoveryCodes: {
    title: "Wiederherstellungscodes",
    warning: "Speichern Sie diese Wiederherstellungscodes jetzt.",
    description:
      "Jeder Code funktioniert einmal. Vorhandene Codes wurden ersetzt und können nicht erneut angezeigt werden.",
    copyAll: "Alle Wiederherstellungscodes kopieren",
    saved: "Ich habe die Codes gespeichert",
  },
  notFound: {
    title: "Seite nicht gefunden",
    description: "Die angeforderte Seite existiert nicht.",
    action: "Zur Startseite",
  },
  home: {
    documentTitle: "Startseite | Vetchium",
    placeholder: "Vetchium-Startseite",
  },
} as const satisfies LocaleResource;
