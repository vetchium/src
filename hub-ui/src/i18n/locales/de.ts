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
    plan: "Tarif",
    settings: "Einstellungen",
    security: "Konto & Sicherheit",
    preferences: "Präferenzen",
    workEmails: "Berufliche E-Mails",
  },
  theme: {
    toggleLabel: "Zwischen hellem und dunklem Modus wechseln",
  },
  language: {
    selectorLabel: "Sprache auswählen",
    changeError:
      "Die Sprache konnte nicht geändert werden. Versuchen Sie es erneut.",
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
    regionDescription:
      "Wählen Sie Ihr Wohnsitzland und die Region für Ihr Konto. Sie können weltweit nach Stellen suchen.",
    regionLabel: "Kontoregion",
    continueRegion: "In {{region}} ({{tenant}}) fortfahren",
    changeRegion: "Land oder Region ändern",
    retryRegions: "Regionen erneut laden",
    noRegions: "Für dieses Land ist derzeit keine Registrierung verfügbar.",
    recommendedRegion: "{{region}} ({{tenant}}) — empfohlen",
    regionOption: "{{region}} ({{tenant}})",
    hosting: "Ihr Konto wird in {{region}} ({{tenant}}) gespeichert.",
    residence: "Aktuelles Wohnsitzland: {{country}}",
    documentTitle: "Konto erstellen | Vetchium",
    title: "Erstellen Sie Ihr Konto",
    description:
      "Wählen Sie Sprache und Wohnsitzland. Der Registrierungslink wird in der gewählten Sprache gesendet.",
    action: "Registrierungslink senden",
    checkEmail:
      "Prüfen Sie Ihren Posteingang. Wenn die Adresse berechtigt ist, wird der Registrierungslink gesendet.",
    haveAccount: "Sie haben bereits ein Konto?",
    signin: "Anmelden",
    terms: "Allgemeine Geschäftsbedingungen",
  },
  completeSignup: {
    documentTitle: "Registrierung abschließen | Vetchium",
    missingToken: "Dieser Registrierungslink ist unvollständig.",
    title: "Passwort wählen",
    action: "Registrierung abschließen",
    pending:
      "Ihr Konto wird fertiggestellt. Diese Seite prüft den Fortschritt weiter.",
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
    continue: "Weiter",
    continueToSignin: "Weiter zur Anmeldung",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    disabled: "Deaktiviert",
    enabled: "Aktiviert",
    loadError: "Diese Informationen konnten nicht geladen werden.",
    retry: "Erneut versuchen",
    save: "Speichern",
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
    signupUnavailable:
      "Diese Region nimmt derzeit keine Registrierungen aus Ihrem Land an. Wählen Sie eine andere Region.",
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
    regionDiscoveryUnavailable:
      "Regionen konnten gerade nicht geladen werden. Versuchen Sie es erneut.",
    planNotOffered: "Dieser Tarif ist für Ihr Konto nicht verfügbar.",
    profileNotFound: "Dieses Profil wurde nicht gefunden.",
    profileUnavailable:
      "Dieses Profil ist vorübergehend nicht verfügbar. Versuchen Sie es erneut.",
    profileConflict:
      "Dieses Profil wurde anderswo geändert. Laden Sie es neu und versuchen Sie es erneut.",
    professionalEmailCodeRejected:
      "Dieser Code wurde nicht akzeptiert. Prüfen Sie ihn oder fordern Sie einen neuen an.",
    profilePictureTooLarge: "Dieses Bild ist größer als 8 MB.",
    profilePictureInvalid:
      "Dieses Bild konnte nicht angenommen werden. Verwenden Sie ein JPEG oder PNG mit mindestens 400 Pixeln je Seite.",
    emailChangeCodeRejected:
      "Dieser Code wurde nicht akzeptiert. Prüfen Sie ihn oder senden Sie einen neuen Code.",
    emailAddressUnavailable:
      "Ein anderes Vetchium-Konto verwendet diese Adresse bereits.",
    planRequired:
      "Für diese Funktion ist ein kostenpflichtiger Tarif erforderlich.",
  },
  profile: {
    documentTitle: "Mein Profil | Vetchium",
    title: "Mein Profil",
    description:
      "So sehen andere Hub-Nutzer und Personalverantwortliche Ihr Profil.",
    locationTitle: "Wohnort",
    residentCountryHelp:
      "Wird in Ihrem Profil angezeigt. Eine Änderung verschiebt weder Ihr Konto noch Ihre bevorzugten Arbeitsländer.",
    residentCountrySaved: "Ihr Wohnsitzland wurde gespeichert.",
    sectionIdentity: "Über Sie",
    sectionBackground: "Werdegang",
    viewPublicProfile: "Mein Profil ansehen",
    shareQr: "Über QR-Code teilen",
    shareQrAlt: "QR-Code für Ihren dauerhaften Profillink",
    loadingPublicFields: "Öffentliche Vorstellung wird geladen",
    biography: "Biografie",
    displayNameInvalid:
      "Geben Sie einen Anzeigenamen mit höchstens 200 Zeichen ein.",
    biographyTooLong: "Die Biografie darf höchstens 2.000 Zeichen enthalten.",
    savePublicFields: "Vorstellung speichern",
    discardChanges: "Änderungen verwerfen",
    publicFieldsSaved: "Ihre öffentliche Vorstellung wurde gespeichert.",
  },
  profileEmails: {
    title: "Ihre Adressen",
    privacyNote:
      "Andere Hub-Nutzer sehen weder diese Adressen noch deren Domains. Arbeitgeber und Personalvermittlungen, die nach Kandidaten suchen, sehen möglicherweise die Domains Ihrer bestätigten Adressen, aber nie die Adressen selbst.",
    addButton: "E-Mail hinzufügen",
    addTitle: "Berufliche E-Mail hinzufügen",
    addressLabel: "Berufliche E-Mail-Adresse",
    addressInvalid:
      "Geben Sie eine berufliche E-Mail-Adresse mit gültiger Domain ein.",
    add: "Hinzufügen und Code senden",
    added: "Adresse hinzugefügt und ein Bestätigungscode wurde gesendet.",
    loading: "Berufliche Adressen werden geladen",
    empty: "Noch keine beruflichen Adressen hinzugefügt.",
    notVerifiedYet: "Noch nicht bestätigt",
    verifiedDates: "Erstmals bestätigt {{first}} · Zuletzt bestätigt {{last}}",
    annualReminder:
      "Die letzte Bestätigung ist ein Jahr her. Sie können einen neuen Code anfordern, wenn Sie die Adresse noch verwenden.",
    requestCode: "Bestätigungscode senden",
    codeSent: "Ein Bestätigungscode wurde an diese Adresse gesendet.",
    codeExpires: "Code läuft {{date}} ab",
    codeLabel: "Sechsstelliger Bestätigungscode",
    verify: "Adresse bestätigen",
    verified: "Adresse bestätigt.",
    remove: "Adresse entfernen",
    confirmRemove: "Diese berufliche Adresse entfernen?",
    cancel: "Abbrechen",
    removed: "Adresse entfernt.",
  },
  profileWork: {
    title: "Berufserfahrung",
    add: "Berufserfahrung hinzufügen",
    addTitle: "Berufserfahrung hinzufügen",
    editTitle: "Berufserfahrung bearbeiten",
    editEntry: "{{title}} bearbeiten",
    deleteEntry: "{{title}} löschen",
    cancel: "Abbrechen",
    delete: "Löschen",
    confirmDelete: "Diese Berufserfahrung löschen?",
    empty: "Noch keine Berufserfahrung hinzugefügt.",
    loading: "Berufserfahrung wird geladen",
    added: "Berufserfahrung hinzugefügt.",
    updated: "Berufserfahrung aktualisiert.",
    removed: "Berufserfahrung entfernt.",
    limitReached: "Sie haben das Limit von 50 Berufserfahrungen erreicht.",
    present: "Heute",
    dateRange: "{{start}} – {{end}}",
    fields: {
      employerDomain: "Arbeitgeber-Domain",
      jobTitle: "Berufsbezeichnung",
      startMonth: "Startmonat",
      endMonth: "Endmonat",
      location: "Ort",
      description: "Beschreibung",
    },
    validation: {
      employer_domain:
        "Geben Sie eine gültige Arbeitgeber-Domain ein, etwa example.com.",
      job_title: "Geben Sie eine Berufsbezeichnung mit bis zu 200 Zeichen ein.",
      start_month:
        "Wählen Sie einen Startmonat zwischen Januar 1900 und diesem Monat.",
      end_month: "Wählen Sie einen Endmonat am oder nach dem Startmonat.",
      location: "Beschränken Sie den Ort auf 200 Zeichen.",
      description: "Beschränken Sie die Beschreibung auf 2.000 Zeichen.",
    },
  },
  profileCertifications: {
    title: "Zertifikate",
    disclaimer:
      "Dies sind von Ihnen angegebene Links. Vetchium überprüft ihre Echtheit nicht.",
    add: "Zertifikat hinzufügen",
    addTitle: "Zertifikat hinzufügen",
    editTitle: "Zertifikat bearbeiten",
    editEntry: "{{title}} bearbeiten",
    deleteEntry: "{{title}} löschen",
    cancel: "Abbrechen",
    delete: "Löschen",
    confirmDelete: "Dieses Zertifikat löschen?",
    empty: "Noch keine Zertifikate hinzugefügt.",
    loading: "Zertifikate werden geladen",
    added: "Zertifikat hinzugefügt.",
    updated: "Zertifikat aktualisiert.",
    removed: "Zertifikat entfernt.",
    limitReached: "Sie haben das Limit von 50 Zertifikaten erreicht.",
    fields: {
      title: "Titel des Zertifikats",
      credentialUrl: "Nachweis-URL",
    },
    validation: {
      title: "Geben Sie einen Zertifikatstitel mit bis zu 200 Zeichen ein.",
      credential_url:
        "Geben Sie eine gültige HTTPS-URL ohne Benutzername, Passwort oder Fragment ein.",
    },
  },
  profileWebsites: {
    title: "Websites",
    description:
      "Links zu Ihrem Code, Ihren Texten oder beruflichen Profilen, etwa GitHub, LinkedIn, X oder Ihrer eigenen Website. Sie erscheinen unter Ihrer Biografie.",
    disclaimer:
      "Dies sind von Ihnen angegebene Links. Vetchium prüft nicht, ob sie Ihnen gehören.",
    add: "Website hinzufügen",
    addTitle: "Website hinzufügen",
    editTitle: "Website bearbeiten",
    editEntry: "{{url}} bearbeiten",
    deleteEntry: "{{url}} löschen",
    cancel: "Abbrechen",
    delete: "Löschen",
    confirmDelete: "Diese Website löschen?",
    empty: "Noch keine Websites hinzugefügt.",
    loading: "Websites werden geladen",
    added: "Website hinzugefügt.",
    updated: "Website aktualisiert.",
    removed: "Website entfernt.",
    limitReached: "Sie haben das Limit von {{limit}} Websites erreicht.",
    fields: {
      url: "Website-URL",
    },
    placeholder: "https://github.com/your-name",
    help: "Verwenden Sie die vollständige Adresse, die mit https:// beginnt.",
    validation: {
      url: "Geben Sie eine gültige HTTPS-Adresse wie https://example.com ohne Benutzername, Passwort oder Fragment ein.",
      duplicate: "Sie haben diese Website bereits hinzugefügt.",
    },
    kinds: {
      github: "GitHub",
      gitlab: "GitLab",
      linkedin: "LinkedIn",
      x: "X",
    },
  },
  profileEducation: {
    title: "Ausbildung",
    add: "Qualifikation hinzufügen",
    addTitle: "Qualifikation hinzufügen",
    editTitle: "Qualifikation bearbeiten",
    editEntry: "{{title}} bearbeiten",
    deleteEntry: "{{title}} löschen",
    cancel: "Abbrechen",
    delete: "Löschen",
    confirmDelete: "Diese Qualifikation löschen?",
    empty: "Noch keine Qualifikationen hinzugefügt.",
    loading: "Qualifikationen werden geladen",
    added: "Qualifikation hinzugefügt.",
    updated: "Qualifikation aktualisiert.",
    removed: "Qualifikation entfernt.",
    limitReached: "Sie haben das Limit von 30 Qualifikationen erreicht.",
    present: "Heute",
    unknown: "Unbekannt",
    dateRange: "{{start}} – {{end}}",
    fields: {
      institutionDomain: "Institutions-Domain",
      degree: "Abschluss",
      title: "Titel",
      supportingText: "Zusätzliche Angaben",
      startMonth: "Startmonat",
      endMonth: "Endmonat",
    },
    validation: {
      institution_domain:
        "Geben Sie eine gültige Institutions-Domain ein, etwa example.edu.",
      degree: "Geben Sie einen Abschluss mit bis zu 200 Zeichen ein.",
      title: "Beschränken Sie den Titel auf 200 Zeichen.",
      supporting_text:
        "Beschränken Sie die zusätzlichen Angaben auf 249 Zeichen.",
      start_month:
        "Wählen Sie einen Startmonat zwischen Januar 1900 und diesem Monat.",
      end_month: "Wählen Sie einen Endmonat am oder nach dem Startmonat.",
    },
  },
  profileLanguages: {
    title: "Sprachen",
    abilities: {
      speaking: "Sprechen",
      reading: "Lesen",
      writing: "Schreiben",
    },
    selectPlaceholder: "Sprachen suchen",
    count: "{{count}}/{{limit}}",
    loading: "Sprachen werden geladen",
    added: "Sprache hinzugefügt.",
    removed: "Sprache entfernt.",
  },
  profileAlias: {
    title: "Profil-Alias",
    canonicalNote:
      "Ihr dauerhafter Profillink lautet {{url}}. Ein Alias ist eine bequeme Alternative, die jederzeit freigegeben werden kann.",
    label: "Profil-Alias",
    rules:
      "3 bis 30 Kleinbuchstaben, Ziffern und einzelne Bindestriche, beginnend mit einem Buchstaben.",
    invalid:
      "Geben Sie 3 bis 30 Kleinbuchstaben ein, beginnend mit einem Buchstaben.",
    save: "Alias speichern",
    remove: "Alias entfernen",
    claiming: "Ihr Alias wird beansprucht.",
    removing: "Ihr Alias wird entfernt.",
    failed:
      "Die Alias-Änderung wurde nicht abgeschlossen. Versuchen Sie es erneut.",
    cooldown: "Sie können Ihren Alias nach {{date}} erneut ändern.",
    loading: "Alias wird geladen",
    upgradeRequired:
      "Für einen Profil-Alias ist ein kostenpflichtiger Tarif erforderlich.",
    viewPlans: "Tarife ansehen",
  },
  profilePicture: {
    title: "Profilbild",
    currentAlt: "Ihr aktuelles Profilbild",
    upload: "Bild hochladen",
    replace: "Bild ersetzen",
    remove: "Bild entfernen",
    confirmRemove: "Ihr Profilbild entfernen?",
    uploaded: "Ihr Profilbild wurde aktualisiert.",
    removed: "Ihr Profilbild wurde entfernt.",
    unsupportedType: "Wählen Sie ein JPEG- oder PNG-Bild.",
    tooLarge: "Wählen Sie ein Bild mit höchstens 8 MB.",
    requirements:
      "JPEG oder PNG, mindestens 400 Pixel je Seite und höchstens 8 MB. Metadaten werden beim Speichern entfernt.",
    loading: "Profilbild wird geladen",
    upgradeRequired:
      "Für ein Profilbild ist ein kostenpflichtiger Tarif erforderlich.",
    viewPlans: "Tarife ansehen",
  },
  profileView: {
    edit: "Mein Profil bearbeiten",
    documentTitle: "{{name}} | Vetchium",
    pictureAlt: "Profilbild von {{name}}",
    workTitle: "Berufserfahrung",
    educationTitle: "Ausbildung",
    certificationsTitle: "Zertifikate",
    languagesTitle: "Sprachen",
    websitesLabel: "Websites",
    empty: "Noch keine Angaben geteilt.",
    present: "Heute",
    unknown: "Unbekannt",
    dateRange: "{{start}} – {{end}}",
    share: "Profil teilen",
    qrAlt: "QR-Code für den dauerhaften Profillink",
    loading: "Profil wird geladen…",
    notFound: "Diese Profiladresse ist ungültig.",
    abilities: {
      speaking: "Sprechen",
      reading: "Lesen",
      writing: "Schreiben",
    },
  },
  security: {
    documentTitle: "Konto & Sicherheit | Vetchium",
    title: "Konto & Sicherheit",
    description:
      "Verwalten Sie E-Mail-Adresse, Passwort und zweiten Faktor für die Anmeldung.",
  },
  emailChange: {
    title: "E-Mail-Adresse",
    description:
      "Mit dieser Adresse melden Sie sich an und erhalten Kontonachrichten. Sie wird nie in Ihrem Profil angezeigt.",
    current: "Aktuelle Adresse",
    start: "E-Mail-Adresse ändern",
    effects:
      "Eine Änderung meldet alle anderen Browser ab und macht zuvor gesendete Links zum Zurücksetzen des Passworts ungültig.",
    newAddress: "Neue E-Mail-Adresse",
    sameAddress: "Geben Sie eine andere als Ihre aktuelle Adresse ein.",
    sendCode: "Bestätigungscode senden",
    codeSent:
      "Falls {{address}} verwendet werden kann, ist ein sechsstelliger Code unterwegs. Er läuft um {{time}} ab.",
    noCodeHint:
      "Kein Code erhalten? Prüfen Sie die Adresse. Eine Adresse, die bereits zu einem Vetchium-Konto gehört, erhält keinen Code.",
    codeLabel: "Sechsstelliger Code",
    codeInvalid: "Geben Sie den sechsstelligen Code aus der E-Mail ein.",
    confirm: "Neue Adresse bestätigen",
    resend: "Neuen Code senden",
    cancel: "Abbrechen",
    changed:
      "Ihre E-Mail-Adresse wurde geändert. Andere Browser wurden abgemeldet.",
  },
  preferences: {
    documentTitle: "Präferenzen | Vetchium",
    title: "Präferenzen",
    description:
      "Legen Sie fest, wie Vetchium für Sie arbeitet. Nur Sie sehen diese Angaben.",
    languageTitle: "Anzeigesprache",
    languageHelp:
      "Gilt für dieses Portal und für die E-Mails, die Vetchium Ihnen sendet.",
    jobSearchTitle: "Jobsuche",
    jobCountries: "Bevorzugte Arbeitsländer",
    jobCountriesHelp:
      "Wählen Sie bis zu 10 Länder. Ohne Auswahl suchen Sie weltweit. Eine Änderung des Wohnsitzlands ändert diese Auswahl nicht.",
    saved: "Ihre Einstellung wurde gespeichert.",
  },
  workEmails: {
    documentTitle: "Berufliche E-Mails | Vetchium",
    title: "Berufliche E-Mails",
    description:
      "Weisen Sie nach, dass Sie eine Adresse bei einem aktuellen oder früheren Arbeitgeber kontrollieren. Die Bestätigung belegt weder Ihre Berufsbezeichnung noch Ihren Beschäftigungszeitraum.",
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
    title: "Willkommen zurück, {{name}}",
    profileTitle: "Ihr Profil",
    profileProgress: "{{done}} von {{total}} Abschnitten vollständig",
    profileComplete:
      "Ihr Profil ist vollständig. Halten Sie es mit Ihrer Laufbahn aktuell.",
    profileIncomplete:
      "Ein vollständiges Profil hilft Kollegen und Personalverantwortlichen, Ihre Erfahrung einzuordnen.",
    profileLoading: "Ihr Profil wird geladen",
    checklist: {
      biography: "Eine kurze Biografie schreiben",
      work: "Berufserfahrung hinzufügen",
      education: "Ausbildung hinzufügen",
      languages: "Ihre Sprachen hinzufügen",
    },
    editProfile: "Mein Profil bearbeiten",
    viewProfile: "Mein Profil ansehen",
    supportTitle: "Vetchium unterstützen",
    supportBody:
      "Vetchium ist freie Open-Source-Software. Der Silber-Tarif finanziert die Entwicklung und bietet ein Profilbild sowie einen Profil-Alias.",
    supportAction: "Tarife ansehen",
    securityTitle: "Konto schützen",
    securityBody:
      "Aktivieren Sie die Zwei-Faktor-Authentifizierung, damit ein gestohlenes Passwort allein Ihr Konto nicht öffnet.",
    securityAction: "Zwei-Faktor-Authentifizierung einrichten",
  },
  plans: {
    endingSoon: "Ihr kostenpflichtiger Zugang endet am {{date}}.",
    endingSoonDetail:
      "Verlängern Sie vorher, um Ihre kostenpflichtigen Funktionen zu behalten. Wir haben auch Ihre Kontoadresse benachrichtigt.",
    endingSoonAction: "Tarife ansehen",
    documentTitle: "Tarife | Vetchium",
    title: "Tarife",
    description:
      "Wählen Sie den Tarif, der zu Ihrer Art passt, Inhalte zu teilen und Kontakte zu knüpfen. Sie können ihn jederzeit ändern.",
    descriptionPaid:
      "Danke, dass Sie die Entwicklung des Vetchium-FOSS-Projekts unterstützen.",
    loadingLabel: "Ihr Abonnement wird geladen",
    billingIntervalLabel: "Abrechnungsintervall",
    annualSaving: "1 Monat sparen",
    pricingNote:
      "Die Preise enthalten Steuern. Zahlungen werden derzeit simuliert, Ihnen wird also nichts berechnet.",
    recommended: "Empfohlen",
    planCardLabel: "Tarif {{plan}}",
    yourPlan: "Ihr Tarif",
    currentBadge: "Aktuell",
    freePrice: "Kostenlos",
    freePriceCaption: "für immer",
    pricePeriod: {
      month: "pro Monat",
      year: "pro Jahr",
    },
    descriptions: {
      free: "Das Wesentliche für Ihre professionelle Präsenz.",
      silver:
        "Mehr Möglichkeiten, sich auszudrücken und Ihr Profil zu personalisieren.",
    },
    featuresTitle: "Enthaltene Leistungen",
    features: {
      professionalProfile: "Professionelles Profil erstellen",
      standardPosts: "Standardbeiträge veröffentlichen",
      professionalNetwork: "Professionelles Netzwerk erweitern",
      everythingInFree: "Alles aus Kostenlos",
      longPosts: "Lange Beiträge",
      profilePictures: "Unterstützung für Profilbilder",
      profileAlias: "Ein eigener Profil-Alias",
    },
    currentTitle: "Aktueller Tarif",
    currentPlan: "Tarif",
    currentInterval: "Abrechnungsintervall",
    currentPeriod: "Aktueller Zeitraum",
    periodRange: "{{start}} – {{end}}",
    scheduledChange: "Wechselt am {{date}} zu {{plan}} ({{interval}}).",
    scheduledCancellation: "Endet am {{date}}, zum Ende des Zeitraums.",
    fossBullet:
      "Die kostenpflichtigen Tarife unterstützen die Entwicklung des Vetchium-FOSS-Projekts.",
    unknownPlanTitle: "Dieser Tarif kann hier nicht geändert werden",
    unknownPlanDescription:
      "Ihr Abonnement verwendet einen Tarif ({{plan}}), den diese Version des Portals nicht kennt. Aktualisieren Sie die App, um den Tarif zu ändern.",
    confirmTitle: "Änderung bestätigen",
    confirmDescription:
      "Dies wird am {{date}}, zum Ende des aktuellen Zeitraums, wirksam.",
    confirmDescriptionNoDate:
      "Dies wird zum Ende des aktuellen Zeitraums wirksam.",
    confirmBack: "Zurück",
    interval: {
      month: "Monatlich",
      year: "Jährlich",
    },
    names: {
      "hub-free-tier": "Kostenlos",
      "hub-silver-tier": "Silber",
    },
    actions: {
      current: "Aktueller Tarif",
      keep: "Diesen Tarif behalten",
      upgrade: "Upgrade",
      switchToAnnual: "Zu jährlich wechseln",
      switchAtPeriodEnd: "Zum Zeitraumende wechseln",
      switchToFree: "Zum kostenlosen Tarif wechseln",
    },
  },
  terms: {
    documentTitle: "Allgemeine Geschäftsbedingungen | Vetchium",
    title: "Allgemeine Geschäftsbedingungen",
    general:
      "Diese Bedingungen beschreiben, wie Vetchium seine Plattform bereitstellt. Die vollständigen rechtlichen Bedingungen werden veröffentlicht, bevor Vetchium allgemein verfügbar ist.",
    profileClaimsTitle: "Angaben im beruflichen Profil",
    profileClaimsBody:
      "Berufserfahrung, Ausbildung, Zertifikate sowie Domains von Arbeitgebern und Bildungseinrichtungen werden von Nutzern angegeben und von Vetchium nicht überprüft, sofern dies nicht ausdrücklich vermerkt ist. Vetchium kann Profileinträge oder Domains ausblenden oder entfernen, wenn sie als irreführend, rechtswidrig, missbräuchlich, unsicher oder anderweitig problematisch eingestuft werden.",
    paymentsTitle: "Zahlungen",
    paymentsBody:
      "Vetchium-Tarife werden noch nicht abgerechnet. Sobald Zahlungen aktiviert sind, werden hier Zahlungsbedingungen zu Preisen, Abrechnungszeiträumen, Erstattungen und Kündigungen veröffentlicht, bevor eine Zahlung erfolgt.",
  },
} as const satisfies LocaleResource;
