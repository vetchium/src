import type { LocaleResource } from "./en";
export const de = {
  shell: {
    documentTitle: "Vetchium für Organisationen",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Startseite von Vetchium für Organisationen",
    footer: "Vetchium für Organisationen",
    logout: "Abmelden",
    operationInProgress:
      "Schließen Sie den laufenden Vorgang ab, bevor Sie die Seite verlassen.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Navigation öffnen",
    home: "Übersicht",
    members: "Personen",
    openings: "Stellenanzeigen",
    plans: "Abrechnung",
    ai: "KI",
    settings: "Unternehmen",
    security: "Mein Konto",
    restoreDomain: "Domain wiederherstellen",
    hiring: "Recruiting",
    organization: "Organisation",
    pipelineTemplates: "Pipeline-Vorlagen",
    myInterviews: "Meine Interviews",
    organizationSecurity: "Organisationssicherheit",
  },
  theme: {
    toggleLabel: "Zwischen hellem und dunklem Modus wechseln",
  },
  language: {
    selectorLabel: "Sprache auswählen",
    changeError:
      "Die Sprache konnte nicht geändert werden. Bitte erneut versuchen.",
  },
  common: {
    done: "Fertig",
    close: "Schließen",
    next: "Weiter",
    previous: "Zurück",
    save: "Speichern",
    backToSignIn: "Zurück zur Anmeldung",
    cancel: "Abbrechen",
    confirm: "Bestätigen",
    continueToSignIn: "Weiter zur Anmeldung",
    loadError: "Diese Informationen konnten nicht geladen werden.",
    loading: "Wird geladen",
    retry: "Erneut versuchen",
    unsavedTitle: "Ohne Speichern verlassen?",
    unsavedContent:
      "Ihre Änderungen auf dieser Seite sind noch nicht gespeichert.",
    unsavedLeave: "Verlassen",
    unsavedStay: "Bleiben",
  },
  fields: {
    confirmPassword: "Passwort bestätigen",
    domain: "Domain der Organisation",
    domainState: "Verifizierung",
    email: "E-Mail-Adresse",
    failingSince: "Fehlerhaft seit",
    lastVerified: "Zuletzt verifiziert",
    newPassword: "Neues Passwort",
    orgDisplayName: "Name der Organisation",
    orgCountry: "Land",
    password: "Passwort",
    permissions: "Berechtigungen",
    recoveryCode: "Wiederherstellungscode",
    releaseAfter: "Freigabe nach",
    totpCode: "Sechsstelliger Code",
  },
  validation: {
    displayName: "Verwenden Sie einen Namen mit 1 bis 200 Zeichen.",
    domain: "Geben Sie eine Domain wie example.com ein, ohne @, http oder www.",
    email: "Geben Sie eine gültige E-Mail-Adresse ein.",
    newPassword:
      "Verwenden Sie 15 bis 128 Zeichen und vermeiden Sie gängige Passwortphrasen.",
    passwordMatch: "Die Passwörter stimmen nicht überein.",
    recoveryCode: "Geben Sie einen gültigen Wiederherstellungscode ein.",
    required: "Dieses Feld ist erforderlich.",
    totpCode: "Geben Sie den sechsstelligen Code ein.",
    specialUseDomain:
      "Reservierte Namen wie .test oder .example können sich nicht registrieren. Geben Sie die echte Domain Ihrer Organisation ein.",
    localPart: "Geben Sie nur den Teil vor dem @ ein.",
  },
  errors: {
    generic:
      "Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    validationFailed:
      "Einige Angaben wurden nicht akzeptiert. Prüfen Sie sie und versuchen Sie es erneut.",
    rateLimited:
      "Zu viele Versuche. Warten Sie einen Moment und versuchen Sie es erneut.",
    idempotencyConflict:
      "Diese Aktion wurde bereits mit anderen Angaben gesendet. Laden Sie die Seite neu und versuchen Sie es erneut.",
    signupUnavailable:
      "Diese Region nimmt derzeit keine Registrierungen von Organisationen an.",
    signupDomainBlocked:
      "Mit dieser Domain kann keine Organisation registriert werden. Öffentliche E-Mail-Anbieter und reservierte Namen wie .test oder .example werden nicht akzeptiert. Verwenden Sie die eigene Domain Ihrer Organisation.",
    domainAlreadyOwned:
      "Diese Domain gehört bereits einer anderen Organisation auf Vetchium.",
    invalidSignupToken:
      "Dieser Registrierungslink ist ungültig, abgelaufen oder wurde bereits verwendet. Fordern Sie einen neuen an.",
    dnsRecordNotFound:
      "Der TXT-Eintrag ist noch nicht sichtbar. DNS-Änderungen können eine Weile dauern. Prüfen Sie den Eintrag unten und versuchen Sie es erneut.",
    directoryUnavailable:
      "Die Inhaberschaft der Domain kann gerade nicht geprüft werden. Versuchen Sie es in einigen Minuten erneut.",
    invalidCredentials:
      "Die Organisationsdomain, E-Mail-Adresse oder das Passwort ist falsch, oder die falsche Region wurde ausgewählt.",
    userDisabled:
      "Dieses Konto ist deaktiviert. Wenden Sie sich an einen Superadmin Ihrer Organisation.",
    incorrectPassword: "Das Passwort wurde nicht akzeptiert.",
    expiredLoginChallenge:
      "Diese Anmeldung ist abgelaufen. Beginnen Sie erneut.",
    incorrectTOTP: "Der Code wurde nicht akzeptiert.",
    incorrectRecoveryCode: "Der Wiederherstellungscode wurde nicht akzeptiert.",
    invalidResetToken:
      "Dieser Link zum Zurücksetzen des Passworts ist ungültig, abgelaufen oder wurde bereits verwendet.",
    invalidInvitation:
      "Diese Einladung ist ungültig, abgelaufen, widerrufen oder bereits verwendet. Fordern Sie eine neue an.",
    invitationNotFound:
      "Für eine Adresse in der Anfrage gibt es keine offene Einladung.",
    userAlreadyExists:
      "In der Organisation gibt es bereits einen Benutzer mit dieser Adresse.",
    selfChange:
      "Sie können sich nicht selbst deaktivieren oder Ihre eigenen Berechtigungen ändern. Bitten Sie einen anderen Administrator.",
    lastSuperadmin:
      "Die Organisation muss mindestens einen aktiven Superadmin behalten.",
    userNotFound: "{{email}} ist kein Benutzer dieser Organisation.",
    superadminRequired:
      "Nur ein Superadmin kann {{email}} oder diese Berechtigungen ändern.",
    userLimitReached:
      "Die Organisation hat keinen freien Platz mehr: Ihr Tarif erlaubt {{limit}} Benutzer, offene Einladungen eingerechnet.",
    planNotOffered: "Dieser Tarif wird in dieser Region nicht angeboten.",
    pipelineTemplateNotFound:
      "Diese Pipeline-Vorlage existiert nicht mehr. Laden Sie die Seite neu.",
    pipelineTemplateNameTaken:
      "Eine andere Pipeline-Vorlage hat bereits diesen Namen.",
    pipelineStageInUse:
      "Eine entfernte Phase enthält noch Kandidaten. Verschieben Sie diese zuerst in eine andere Phase.",
    orgSuspended:
      "Ihre Organisation ist gesperrt. Stellen Sie ihre Domain wieder her, um fortzufahren.",
    userLimitExceedsTarget:
      "Ihre Organisation hat {{seats}} Benutzer und offene Einladungen, dieser Tarif erlaubt {{limit}}. Deaktivieren Sie zuerst Benutzer oder widerrufen Sie Einladungen.",
    logoInvalid:
      "Dieses Bild kann nicht verwendet werden. Wählen Sie ein nicht animiertes PNG oder JPEG, dessen Seiten jeweils zwischen 128 und 4.096 Pixel lang sind.",
    logoTooLarge: "Dieses Bild ist größer als 2 MiB.",
    logoConflict:
      "Das Logo wurde gleichzeitig von jemand anderem geändert. Versuchen Sie es erneut.",
    ssoSignInFailed:
      "Die Anmeldung mit Google hat nicht funktioniert. Prüfen Sie, ob Sie das Google-Konto Ihrer Organisation gewählt haben, ob Ihre Organisation die Google-Anmeldung aktiviert hat und ob Sie eingeladen wurden. Sie können sich stattdessen mit Ihrem Passwort anmelden.",
    ssoNotAvailable:
      "Die Anmeldung mit Google ist in dieser Region nicht verfügbar.",
    planRequired: "Dafür ist ein höherer Tarif nötig.",
    permissionRequired: "Nur ein Superadmin Ihrer Organisation kann das tun.",
    recentAuthenticationRequired: "Melden Sie sich erneut an, um fortzufahren.",
    totpAlreadyEnabled: "Die Zwei-Faktor-Authentifizierung ist bereits aktiv.",
    totpNotEnabled: "Die Zwei-Faktor-Authentifizierung ist ausgeschaltet.",
    invalidEnrollment:
      "Diese Einrichtung ist abgelaufen. Beginnen Sie sie erneut.",
  },
  signup: {
    regionDescription:
      "Wählen Sie, wo die Daten Ihrer Organisation gespeichert werden. Geben Sie anschließend Ihre Domain und E-Mail-Adresse ein.",
    selectRegion: "Region auswählen",
    regionLabel: "Region",
    regionOption: "{{region}} ({{tenant}})",
    noRegions:
      "Derzeit nimmt keine Region Registrierungen von Organisationen an.",
    documentTitle: "Registrieren | Vetchium für Organisationen",
    title: "Organisation registrieren",
    description:
      "Ihre Organisation wird über ihre Domain erkannt. Um zu belegen, dass sie die Domain verwaltet, veröffentlichen Sie einen DNS-Eintrag, den wir Ihnen senden.",
    requester:
      "Das sollte die Person übernehmen, die die Domain für die Organisation verwaltet, meist die IT. Wer die Registrierung abschließt, wird der erste Superadmin der Organisation.",
    domainHelp:
      "Die Domain in den E-Mail-Adressen Ihrer Organisation, etwa example.com, ohne www oder https.",
    emailLabel: "Ihre E-Mail-Adresse",
    emailHelp:
      "Sie müssen E-Mails an diese Adresse lesen können. Sie werden der erste Superadmin der Organisation.",
    steps: {
      title: "So geht es weiter",
      yourDomain: "Ihre Domain",
      emails: {
        title: "Wir senden Ihnen zwei E-Mails",
        content:
          "Eine enthält einen DNS-TXT-Eintrag für {{domain}}; Sie können sie an die Person weiterleiten, die das DNS der Domain verwaltet. Die andere enthält Ihren privaten Registrierungslink; leiten Sie sie nicht weiter.",
      },
      record: {
        title: "TXT-Eintrag veröffentlichen",
        content:
          "Fügen Sie den Eintrag dem DNS von {{domain}} hinzu. Damit belegen Sie, dass Ihre Organisation die Domain verwaltet. DNS-Änderungen können einige Stunden brauchen, bis sie sichtbar sind.",
      },
      complete: {
        title: "Privaten Link öffnen und Passwort festlegen",
        content:
          "Sobald der Eintrag sichtbar ist, öffnen Sie den Link, benennen die Organisation und legen Ihr Passwort fest. Beim Absenden wird der Eintrag erneut geprüft.",
      },
    },
    action: "Registrierungs-E-Mails senden",
    haveAccount: "Bereits registriert?",
    signIn: "Anmelden",
    sent: {
      title: "Prüfen Sie Ihren Posteingang",
      description:
        "Falls sich {{email}} für die Registrierung eignet, sind zwei E-Mails an diese Adresse unterwegs.",
      dnsTitle: "DNS-Anleitung.",
      dnsBody:
        "Diese E-Mail enthält den TXT-Eintrag, der für {{domain}} veröffentlicht werden muss. Sie können sie an die Person weiterleiten, die das DNS der Domain verwaltet.",
      linkTitle: "Privater Registrierungslink.",
      linkBody:
        "Leiten Sie diese E-Mail nicht weiter. Jeder, der den Link hat, kann die Registrierung abschließen.",
      next: "Öffnen Sie den privaten Link, sobald der Eintrag veröffentlicht ist, um die Organisation zu benennen und Ihr Passwort festzulegen.",
    },
  },
  terms: {
    documentTitle: "Bedingungen für Organisationen | Vetchium",
    title: "Bedingungen für Organisationen",
    version: "Version {{version}}",
    placeholder:
      "Platzhaltertext: Dies sind nicht die Bedingungen von Vetchium für Organisationen. Die endgültigen Bedingungen ersetzen diese Seite vor dem Start.",
    sections: {
      service: {
        title: "Nutzung von Vetchium",
        body: "Eine Organisation nutzt Vetchium, um Stellenanzeigen zu veröffentlichen und Einstellungen zu verwalten. Die Person, die die Registrierung abschließt, akzeptiert diese Bedingungen im Namen der Organisation.",
      },
      accounts: {
        title: "Domain und Konten",
        body: "Die Organisation hält ihre Domain verifiziert und ist für die Personen verantwortlich, die sie einlädt, und für die Berechtigungen, die sie ihnen erteilt.",
      },
      openings: {
        title: "Stellenanzeigen",
        body: "Vetchium prüft den Inhalt von Stellenanzeigen nicht. Es kann eine Stellenanzeige entfernen, die es für rechtswidrig, diskriminierend, irreführend oder missbräuchlich hält.",
      },
      changes: {
        title: "Änderungen dieser Bedingungen",
        body: "Wenn sich diese Bedingungen ändern, ändert sich ihre Version, und die Organisation kann aufgefordert werden, die neue Version zu akzeptieren.",
      },
    },
  },
  completeSignup: {
    documentTitle: "Registrierung abschließen | Vetchium für Organisationen",
    title: "Registrierung Ihrer Organisation abschließen",
    missingToken:
      "Dieser Registrierungslink ist unvollständig. Öffnen Sie den vollständigen Link aus der E-Mail.",
    startOver: "Neuen Registrierungslink anfordern",
    instructions:
      "Veröffentlichen Sie diesen TXT-Eintrag im DNS von {{domain}}, benennen Sie dann die Organisation und legen Sie Ihr Passwort fest. Der Eintrag wird beim Absenden geprüft.",
    expires: "Link läuft ab",
    displayNameHelp:
      "Wird auf Vetchium angezeigt. Der Name muss nicht eindeutig sein.",
    countryHelp:
      "Wo die Organisation ihren Sitz hat. Neue Stellenanzeigen übernehmen es als Land der Beschäftigung.",
    acceptTerms:
      "Ich akzeptiere die Bedingungen für Organisationen im Namen dieser Organisation.",
    readTerms: "Bedingungen für Organisationen lesen (öffnet in neuem Tab)",
    termsRequired:
      "Akzeptieren Sie die Bedingungen, um die Organisation anzulegen.",
    action: "Domain verifizieren und Organisation anlegen",
    pending:
      "Die Domain ist verifiziert und die Organisation wird angelegt. Diese Seite prüft automatisch erneut.",
    stillPending:
      "Die Organisation wird noch angelegt. Prüfen Sie in einigen Minuten erneut.",
    checkAgain: "Erneut prüfen",
    recordCheck: {
      checking: "Eintrag wird im öffentlichen DNS gesucht…",
      again: "Erneut prüfen",
      present: {
        title: "Der Eintrag ist im öffentlichen DNS sichtbar.",
        description: "Sie können die Registrierung jetzt abschließen.",
      },
      absent: {
        title: "Der Eintrag ist noch nicht sichtbar.",
        description:
          "DNS-Änderungen können einige Stunden brauchen, bis sie sichtbar sind. Wir empfehlen, zu warten und vor dem Absenden erneut zu prüfen. Sie können trotzdem jetzt absenden, aber die Registrierung gelingt erst, wenn der Eintrag sichtbar ist.",
      },
      inconclusive: {
        title: "Der Eintrag konnte in Ihrem Browser nicht geprüft werden.",
        description:
          "Sie können trotzdem absenden. Der Eintrag wird dann geprüft.",
      },
    },
    success:
      "Ihre Organisation ist bereit. Melden Sie sich an, um fortzufahren.",
  },
  dnsRecord: {
    type: "Typ",
    txt: "TXT",
    name: "Name",
    value: "Wert",
  },
  region: {
    label: "Region",
    help: "Das Konto Ihrer Organisation befindet sich in genau einer Region. Wählen Sie die Region, in der sie sich registriert hat.",
    option: "{{country}} ({{tenantId}})",
  },
  login: {
    documentTitle: "Anmelden | Vetchium für Organisationen",
    title: "Anmelden",
    description: "Melden Sie sich beim Konto Ihrer Organisation an.",
    domainHelp: "Die Domain Ihrer Organisation, etwa example.com.",
    action: "Anmelden",
    forgotPassword: "Passwort vergessen?",
    noAccount: "Ist Ihre Organisation noch nicht auf Vetchium?",
    signUp: "Jetzt registrieren",
    or: "oder",
    google: "Weiter mit Google",
  },
  googleCallback: {
    documentTitle: "Google-Anmeldung | Vetchium für Organisationen",
    title: "Google-Anmeldung",
    failed:
      "Die Anmeldung mit Google konnte nicht abgeschlossen werden. Beginnen Sie erneut oder melden Sie sich mit Ihrem Passwort an.",
    back: "Zurück zur Anmeldung",
  },
  twoFactor: {
    documentTitle: "Zwei-Faktor-Prüfung | Vetchium für Organisationen",
    title: "Bestätigen Sie Ihre Identität",
    description:
      "Geben Sie den Code aus Ihrer Authenticator-App oder einen Ihrer Wiederherstellungscodes ein.",
    methodLabel: "Prüfmethode",
    authenticator: "Authenticator-App",
    recovery: "Wiederherstellungscode",
    action: "Prüfen",
    restart: "Anmeldung neu beginnen",
    recoveryCodesLeft:
      "Verbleibende Wiederherstellungscodes: {{count}}. Ersetzen Sie sie auf der Sicherheitsseite, bevor sie ausgehen.",
  },
  forgotPassword: {
    documentTitle: "Passwort zurücksetzen | Vetchium für Organisationen",
    title: "Passwort vergessen?",
    description:
      "Geben Sie die Domain Ihrer Organisation und Ihre E-Mail-Adresse ein. Wenn sie zu einem Konto passen, senden wir Ihnen einen Link zum Zurücksetzen.",
    action: "Link senden",
    checkEmail:
      "Wenn Domain und E-Mail-Adresse zu einem Konto passen, ist ein Link zum Zurücksetzen unterwegs.",
  },
  resetPassword: {
    documentTitle: "Neues Passwort | Vetchium für Organisationen",
    title: "Neues Passwort wählen",
    missingToken:
      "Dieser Link zum Zurücksetzen ist unvollständig. Öffnen Sie den vollständigen Link aus der E-Mail.",
    requestAnother: "Neuen Link anfordern",
    success:
      "Ihr Passwort wurde geändert und Ihre anderen Sitzungen wurden abgemeldet. Sie können sich jetzt anmelden.",
    action: "Passwort ändern",
  },
  reauthentication: {
    title: "Erneut anmelden, um fortzufahren",
    description:
      "Bestätigen Sie zu Ihrer Sicherheit Ihr Passwort, bevor Sie Anmeldeeinstellungen ändern. Sie bleiben angemeldet.",
    action: "Passwort bestätigen",
    documentTitle: "Passwort bestätigen | Vetchium für Organisationen",
    pageTitle: "Passwort bestätigen",
    pageDescription:
      "Für Änderungen an Anmeldeeinstellungen ist eine kürzliche Anmeldung nötig. Sie bleiben in jedem Fall angemeldet.",
    account: "{{email}} bei {{domain}}",
    confirm: "Weiter",
  },
  home: {
    documentTitle: "Startseite | Vetchium für Organisationen",
    description: "Ihre Organisation auf Vetchium.",
    domainCard: "Domain",
    accountCard: "Ihr Zugriff",
    noPermissions: "Keine Berechtigungen",
    title: "Übersicht",
  },
  permissions: {
    "org:superadmin": {
      name: "SUPERADMIN",
      description:
        "Alles in der Organisation, einschließlich Abrechnung und Benutzer, sowie die Einstellungen der Organisation.",
    },
    "org:manage_users": {
      name: "MANAGE_USERS",
      description:
        "Benutzer einladen, deaktivieren und wieder aktivieren und ihre Berechtigungen ändern, außer Superadmin, Abrechnung, KI-Verwaltung und Freigabe von Stellenanzeigen.",
    },
    "org:manage_billing": {
      name: "MANAGE_BILLING",
      description:
        "Den Tarif und das Abrechnungsintervall der Organisation auswählen.",
    },
    "org:manage_ai": {
      name: "MANAGE_AI",
      description:
        "KI-Unterstützung ein- oder ausschalten, die Modelle jeder KI-Funktion festlegen, KI-Guthaben kaufen und die KI-Nutzung einsehen.",
    },
    "org:view_openings": {
      name: "VIEW_OPENINGS",
      description:
        "Alle Stellenanzeigen der Organisation sehen, auch Entwürfe.",
    },
    "org:manage_openings": {
      name: "MANAGE_OPENINGS",
      description:
        "Stellenanzeigen erstellen, bearbeiten und zur Freigabe einreichen.",
    },
    "org:approve_openings": {
      name: "APPROVE_OPENINGS",
      description:
        "Änderungen an veröffentlichten Stellenanzeigen freigeben oder ablehnen.",
    },
    "org:manage_candidacies": {
      name: "MANAGE_CANDIDACIES",
      description: "Bewerbungen aller Stellenanzeigen lesen und bearbeiten.",
    },
    "org:manage_providers": {
      name: "MANAGE_PROVIDERS",
      description:
        "Dienstleister finden, Aufträge vorschlagen und beenden, zuweisen und Tätigkeitsnachweise lesen.",
    },
    "org:manage_listings": {
      name: "MANAGE_LISTINGS",
      description:
        "Eigene Einträge bearbeiten, Kunden annehmen oder ablehnen und Tätigkeitsnachweise lesen.",
    },
    "org:fulfil_engagements": {
      name: "FULFIL_ENGAGEMENTS",
      description:
        "Zugewiesene Arbeit für Kunden erledigen sowie Agenturkontakte und Nachrichten nutzen.",
    },
    unknown: {
      description:
        "Diese Berechtigung wurde nach der Erstellung dieses Portals hinzugefügt. Sie bleibt unverändert, solange Sie sie nicht ausschalten.",
    },
    includedBy: "Enthalten in {{permission}}",
  },
  domain: {
    states: {
      verified: "Verifiziert",
      failing: "Fehlerhaft",
      released: "Freigegeben",
    },
    failing: {
      region: "Domain-Verifizierung",
      title: "Der Verifizierungseintrag für {{domain}} fehlt",
      description:
        "Bei den letzten Prüfungen wurde der TXT-Eintrag Ihrer Domain nicht gefunden. Veröffentlichen Sie ihn erneut, sonst wird die Domain freigegeben und Ihre Organisation gesperrt.",
      descriptionWithDeadline:
        "Bei den letzten Prüfungen wurde der TXT-Eintrag Ihrer Domain nicht gefunden. Veröffentlichen Sie ihn erneut. Fehlt er nach {{releaseAfter}} noch immer, wird die Domain freigegeben und Ihre Organisation gesperrt.",
    },
    check: {
      action: "Jetzt prüfen",
      present: "Der Eintrag wurde gefunden. Ihre Domain ist verifiziert.",
      presentButClaimed:
        "Der Eintrag wurde gefunden, aber eine andere Organisation hat die Domain nach ihrer Freigabe übernommen. Sie kann nicht wiederhergestellt werden.",
      absent:
        "Der Eintrag wurde nicht gefunden. Prüfen Sie, ob er genau wie angezeigt veröffentlicht ist.",
      inconclusive:
        "Die DNS-Abfrage wurde nicht abgeschlossen, daher hat sich nichts geändert. Versuchen Sie es später erneut.",
      superadminOnly:
        "Nur ein Superadmin Ihrer Organisation kann die Domain jetzt prüfen. Sie wird auch automatisch geprüft.",
    },
  },
  restore: {
    documentTitle: "Domain wiederherstellen | Vetchium für Organisationen",
    title: "Domain Ihrer Organisation wiederherstellen",
    description:
      "{{domain}} wurde freigegeben und Ihre Organisation ist gesperrt, bis die Domain erneut verifiziert ist.",
    suspended: "Ihre Organisation ist gesperrt",
    suspendedDetail:
      "Der TXT-Eintrag der Domain fehlte zu lange. Bis zur Wiederherstellung können Sie nur die Domain wiederherstellen, Ihre eigene Anmeldesicherheit verwalten und sich abmelden.",
    recordCard: "Zu veröffentlichender Eintrag",
    publish:
      "Veröffentlichen Sie diesen TXT-Eintrag im DNS von {{domain}} und prüfen Sie ihn anschließend.",
    claimedElsewhere:
      "Hat eine andere Organisation {{domain}} nach der Freigabe übernommen, kann die Domain nicht für diese Organisation wiederhergestellt werden.",
  },
  security: {
    documentTitle: "Mein Konto | Vetchium",
    title: "Mein Konto",
    description:
      "Verwalten Sie Ihre persönlichen Anmelde- und Sicherheitseinstellungen.",
    password: {
      title: "Passwort",
      description:
        "Wenn Sie Ihr Passwort ändern, werden Ihre anderen Sitzungen abgemeldet.",
      action: "Passwort ändern",
      changed: "Ihr Passwort wurde geändert.",
    },
    twoFactor: {
      title: "Zwei-Faktor-Authentifizierung",
      description:
        "Ergänzen Sie jede Anmeldung um einen Code aus einer Authenticator-App. Hier können Sie sie einrichten, Ihre Wiederherstellungscodes ersetzen oder sie ausschalten.",
      status: "Zwei-Faktor-Authentifizierung",
      recoveryCodes: "Unbenutzte Wiederherstellungscodes",
      statusEnabled: "Aktiv",
      statusDisabled: "Aus",
      start: "Authenticator-App einrichten",
      scan: "Scannen Sie diesen QR-Code mit Ihrer Authenticator-App oder geben Sie den Schlüssel von Hand ein. Geben Sie dann den angezeigten Code ein.",
      qrLabel: "QR-Code für Ihre Authenticator-App",
      manualKey: "Einrichtungsschlüssel",
      algorithm: "Algorithmus",
      digits: "Stellen",
      period: "Intervall",
      seconds: "{{seconds}} Sekunden",
      expires: "Einrichtung läuft ab",
      confirm: "Einschalten",
      enabled: "Die Zwei-Faktor-Authentifizierung ist aktiv.",
      disable: "Ausschalten",
      disableConfirm: "Zwei-Faktor-Authentifizierung ausschalten?",
      disableWarning:
        "Für die Anmeldung genügt dann Ihr Passwort, und Ihre Wiederherstellungscodes werden ungültig.",
      disabled: "Die Zwei-Faktor-Authentifizierung ist ausgeschaltet.",
    },
    recoveryCodes: {
      title: "Wiederherstellungscodes speichern",
      warning: "Diese Codes werden nur einmal angezeigt.",
      description:
        "Mit jedem Code können Sie sich einmal anmelden, falls Sie Ihre Authenticator-App verlieren. Bewahren Sie sie sicher auf.",
      copyAll: "Alle Codes kopieren",
      saved: "Ich habe sie gespeichert",
      regenerate: "Wiederherstellungscodes ersetzen",
      regenerateConfirm:
        "Wiederherstellungscodes ersetzen? Die aktuellen Codes werden ungültig.",
      regenerated: "Neue Wiederherstellungscodes wurden erstellt.",
    },
  },
  ai: {
    documentTitle: "KI | Vetchium für Organisationen",
    title: "KI",
    description:
      "KI-Unterstützung einschalten, die Modelle jeder KI-Funktion festlegen, KI-Guthaben verwalten und die KI-Nutzung prüfen.",
    descriptionNotInPlan:
      "Was KI-Unterstützung für Ihre Organisation leisten kann und wie Sie sie erhalten.",
    loading: "KI-Einstellungen werden geladen",
    unavailable:
      "In der Region Ihrer Organisation wird noch keine KI-Unterstützung angeboten.",
    tabs: {
      settings: "Einstellungen",
      credits: "Guthaben",
      usage: "Nutzung",
    },
    operations: {
      "org-opening-draft": "Entwürfe für Stellenausschreibungen",
    },
    draft: {
      button: "Mit KI entwerfen",
      title: "Mit KI entwerfen",
      help: "Beschreiben Sie die Stelle oder was geändert werden soll. Der Entwurf füllt den Editor; gespeichert wird erst, wenn Sie speichern.",
      instructionLabel: "Was soll die KI schreiben?",
      placeholder:
        "Zum Beispiel: eine erfahrene Backend-Entwicklerin für unser Zahlungsteam in Berlin, hybrid, fünf Jahre Go",
      modelLabel: "Modell",
      modelOption: "{{name}} ({{vendor}})",
      generate: "Entwurf erstellen",
      review: "KI kann sich irren. Prüfen Sie jedes Feld, bevor Sie speichern.",
      applied:
        "Entwurf eingefügt. {{credits}} Guthaben verbraucht ({{input}} Eingabe- und {{output}} Ausgabe-Tokens); {{left}} übrig. Prüfen und dann speichern.",
      dropped:
        "Einige von der KI vorgeschlagene Felder waren ungültig und wurden weggelassen: {{fields}}",
      unavailable: {
        notEnabled:
          "Die KI-Unterstützung ist für Ihre Organisation ausgeschaltet. Jemand mit MANAGE_AI kann sie in den KI-Einstellungen einschalten.",
        planRequired: "Das Entwerfen mit KI ist im Gold-Tarif enthalten.",
        changePlan:
          "Speichern Sie Ihre Arbeit und ändern Sie dann den Tarif auf der Seite „Abrechnung“.",
        noCredits: "Ihre Organisation hat kein KI-Guthaben mehr.",
        noModel: "Für Entwürfe ist kein KI-Modell verfügbar.",
        operationOff:
          "Ihre Organisation hat KI-Entwürfe für Stellenanzeigen ausgeschaltet. Jemand mit MANAGE_AI kann sie in den KI-Einstellungen wieder einschalten.",
      },
      errors: {
        notEnabled:
          "Die KI-Unterstützung ist für Ihre Organisation ausgeschaltet.",
        planRequired: "Das Entwerfen mit KI erfordert den Gold-Tarif.",
        noCredits:
          "Ihre Organisation hat nicht genug KI-Guthaben für diesen Entwurf.",
        modelNotAllowed:
          "Ihre Organisation erlaubt dieses Modell nicht mehr. Wählen Sie ein anderes.",
        inProgress:
          "Dieser Entwurf wird noch geschrieben. Bitte warten Sie kurz.",
        modelFailed:
          "Das KI-Modell hat nicht geantwortet. Es wurde kein Guthaben verbraucht. Versuchen Sie es erneut.",
        unusable:
          "Die Antwort der KI war nicht verwendbar. Es wurde kein Guthaben verbraucht. Formulieren Sie Ihre Anfrage anders.",
        operationOff:
          "Ihre Organisation hat KI-Entwürfe für Stellenanzeigen ausgeschaltet.",
      },
      available: "{{available}} Guthaben verfügbar.",
    },
    settings: {
      title: "KI-Unterstützung",
      unavailableModels:
        "Diese Region bietet einige von Ihrer Organisation gewählte Modelle nicht mehr an: {{models}}. Stattdessen gilt die Vorgabe der Region.",
      enabled: "KI-Unterstützung",
      on: "Ein",
      off: "Aus",
      termsAccepted:
        "KI-Bedingungen Version {{version}} akzeptiert am {{date}}.",
      modelsTitle: "KI-Funktionen",
      saved: "Einstellungen für {{feature}} gespeichert.",
      errors: {
        termsRequired:
          "Akzeptieren Sie die aktuellen KI-Bedingungen, um die KI-Unterstützung einzuschalten.",
        modelNotOffered: "Diese Region bietet nicht an: {{models}}",
      },
      onHelp:
        "Personen mit den nötigen Berechtigungen können KI-Funktionen nutzen.",
      offHelp: "Niemand in Ihrer Organisation kann KI-Funktionen nutzen.",
      turnedOn: "KI-Unterstützung eingeschaltet.",
      turnedOff: "KI-Unterstützung ausgeschaltet.",
      turnOffTitle: "KI-Unterstützung ausschalten?",
      turnOffContent:
        "Niemand in Ihrer Organisation kann KI-Funktionen nutzen, bis sie wieder eingeschaltet wird. Guthaben, Einstellungen und Nutzungsverlauf bleiben erhalten.",
      turnOff: "Ausschalten",
      modelsHelp:
        "Legen Sie fest, welche Modelle jede KI-Funktion nutzen darf, oder schalten Sie eine Funktion aus. Jede Funktion wird einzeln gespeichert.",
      modelsFor: "Modelle für {{feature}}",
      modeAll: "Alle Modelle dieser Region",
      modeAllHelp:
        "Später hinzukommende Modelle sind ebenfalls erlaubt. {{model}} ist vorausgewählt.",
      modeSelected: "Nur die von mir gewählten Modelle",
      modeSelectedHelp:
        "Wählen Sie die erlaubten Modelle und das vorausgewählte.",
      modeOff: "Aus",
      modeOffHelp: "Niemand in Ihrer Organisation kann {{feature}} nutzen.",
      allow: "Erlauben",
      allowModel: "{{model}} erlauben",
      preselected: "Vorausgewählt",
      preselectModel: "{{model}} vorauswählen",
      chooseModel:
        "Wählen Sie mindestens ein Modell oder schalten Sie die Funktion aus.",
      unsaved: "Nicht gespeichert",
      save: "Speichern",
      discard: "Verwerfen",
    },
    terms: {
      title: "KI-Bedingungen",
      p1: "Platzhaltertext: vor dem Start durch die geprüften KI-Bedingungen ersetzen.",
      p2: "KI-Funktionen senden den Text, den Sie schreiben, und die bearbeiteten Inhalte an die KI-Modelle der Region Ihrer Organisation. Die Modelle laufen in dieser Region.",
      p3: "Vetchium bewahrt jede Eingabe und Antwort für begrenzte Zeit für Support und Missbrauchsprüfung auf. Personen Ihrer Organisation mit MANAGE_AI und Vetchium-Administratoren mit einer eigenen Berechtigung können sie lesen; jeder Lesezugriff von Administratoren wird festgehalten.",
      p4: "KI-Ausgaben können falsch oder unvollständig sein. Personen Ihrer Organisation prüfen sie, bevor sie gespeichert oder veröffentlicht werden.",
      accept:
        "Ich akzeptiere die KI-Bedingungen (Version {{version}}) für meine Organisation.",
      acceptAndTurnOn: "Akzeptieren und einschalten",
    },
    models: {
      title: "Modelle in dieser Region",
      name: "Modell",
      vendor: "Anbieter",
      licence: "Lizenz",
      rates: "Guthaben pro Million Tokens",
      inputRate: "Eingabe-Tokens",
      outputRate: "Ausgabe-Tokens",
      tokensHelp:
        "Modelle berechnen die Tokens, die sie lesen (Eingabe: die Anweisungen, Ihre Anfrage und der bearbeitete Inhalt), getrennt von den Tokens, die sie schreiben (Ausgabe). Ein Token entspricht etwa drei Vierteln eines englischen Wortes.",
      status: "Verfügbarkeit",
      offered: "Angeboten",
      withdraws: "Angeboten bis {{date}}",
    },
    credits: {
      grantIncluded:
        "Ihr Tarif enthält jeden Monat {{credits}} KI-Guthabenpunkte. Sie werden zuerst verbraucht und verfallen am Monatsende.",
      grantNotIncluded: "Ihr Tarif enthält kein monatliches KI-Guthaben.",
      packsTitle: "Guthaben kaufen",
      simulated:
        "Zahlungen werden während der Entwicklung simuliert: Ein Paketkauf schreibt das Guthaben gut, ohne Sie zu belasten. Gekauftes Guthaben verfällt zwölf Monate nach dem Kauf.",
      goldOnly: "Der Kauf von Guthaben erfordert den Gold-Tarif.",
      packCredits: "{{credits}} Guthabenpunkte",
      buy: "Kaufen",
      buyTitle: "{{credits}} Guthabenpunkte kaufen?",
      buySimulated:
        "Der angegebene Preis beträgt {{price}}. Zahlungen werden während der Entwicklung simuliert, Sie werden nicht belastet.",
      bought: "Guthaben gutgeschrieben.",
      lotsTitle: "Guthabenverlauf",
      noLots: "Noch kein Guthaben",
      kind: "Herkunft",
      kinds: {
        grant: "Monatsguthaben",
        purchase: "Kauf",
      },
      granted: "Guthaben",
      remaining: "Übrig",
      added: "Hinzugefügt",
      expires: "Verfällt",
    },
    usage: {
      title: "KI-Nutzung",
      help: "Alle KI-Anfragen, neueste zuerst. Eingaben und Antworten werden für begrenzte Zeit aufbewahrt.",
      empty: "Noch keine KI-Anfragen",
      when: "Zeitpunkt",
      operation: "Funktion",
      model: "Modell",
      user: "Benutzer",
      outcome: "Ergebnis",
      states: {
        reserved: "Läuft",
        settled: "Abgeschlossen",
        released: "Fehlgeschlagen",
        abandoned: "Abgebrochen",
      },
      failures: {
        model_failed: "Modell fehlgeschlagen",
        unusable_output: "Unbrauchbare Antwort",
        abandoned: "Abgebrochen",
      },
      tokens: "Tokens",
      inputTokens: "Eingabe",
      outputTokens: "Ausgabe",
      credits: "Guthaben",
      text: "Eingabe und Antwort",
      view: "Ansehen",
      viewFor: "Eingabe und Antwort von {{time}} ansehen",
      deleted: "Gelöscht",
      textTitle: "Eingabe und Antwort",
      textUnreadable:
        "Sie können diese Eingabe nicht lesen: Sie betrifft Stellenausschreibungen, die Sie nicht einsehen dürfen.",
      textExpires: "Aufbewahrt bis {{date}}.",
      roles: {
        system: "Anweisungen",
        user: "Anfrage",
      },
      answer: "Antwort",
      noAnswer: "Das Modell hat nicht geantwortet.",
    },
    statusOn: "KI an",
    statusOff: "KI aus",
    statusNotInPlan: "Nicht in Ihrem Tarif",
    offNotice:
      "Die KI-Unterstützung ist ausgeschaltet, daher kann niemand in Ihrer Organisation KI-Funktionen nutzen.",
    openSettings: "Einstellungen öffnen",
    purchasedOnly:
      "Ihr Tarif enthält keine KI mehr. Ihre Organisation kann ihr gekauftes Guthaben von {{credits}} weiter nutzen, bis es aufgebraucht ist oder verfällt; weiteres Guthaben zu kaufen erfordert den Gold-Tarif.",
    upgrade: {
      title: "KI-Unterstützung ist im Gold-Tarif enthalten",
      intro: "Mit Gold erhalten die Personen in Ihrer Organisation:",
      drafting:
        "Entwürfe für Stellenanzeigen, von KI aus einer kurzen Beschreibung geschrieben und bereit zur Prüfung",
      monthly: "{{credits}} KI-Guthabenpunkte pro Monat",
      packs: "Zusätzliches Guthaben zum Kaufen, wann immer Sie es brauchen",
      seePlans: "Tarife ansehen",
      askBilling:
        "Bitten Sie eine Person, die in Ihrer Organisation die Abrechnung verwaltet, zum Gold-Tarif zu wechseln.",
    },
    summary: {
      monthlyTitle: "Guthaben dieses Monats",
      purchasedTitle: "Gekauftes Guthaben",
      percentUsed: "{{percent}} % verbraucht",
      underOnePercent: "Unter 1 % verbraucht",
      gaugeLabel: "{{title}}: verbrauchter Anteil",
      left: "{{left}} von {{total}} übrig",
      monthlyRenews:
        "Erneuert sich am {{date}}. Nicht genutztes Guthaben verfällt dann.",
      monthlyPending:
        "Ihr Tarif enthält jeden Monat {{credits}} Guthaben. Das Guthaben dieses Monats trifft in Kürze ein.",
      monthlyNone:
        "Ihr Tarif enthält kein monatliches Guthaben. Der Gold-Tarif schon.",
      purchasedExpires: "Der früheste Kauf verfällt am {{date}}.",
      purchasedNone: "Kein gekauftes Guthaben.",
      buy: "Guthaben kaufen",
      warning:
        "{{percent}} % Ihres KI-Guthabens sind verbraucht. Kaufen Sie nach, bevor es aufgebraucht ist.",
      exhausted:
        "Ihr KI-Guthaben ist aufgebraucht. KI-Funktionen stehen erst wieder zur Verfügung, wenn Sie Guthaben kaufen oder das Guthaben des nächsten Monats eintrifft.",
      reserved:
        "{{credits}} Guthaben sind von laufenden KI-Anfragen reserviert.",
    },
  },
  plans: {
    documentTitle: "Tarif und Abrechnung | Vetchium für Organisationen",
    title: "Abrechnung",
    description:
      "Verwalten Sie den Tarif und die verfügbaren Plätze Ihrer Organisation.",
    loadingLabel: "Tarife werden geladen",
    names: {
      "org-free-tier": "Free",
      "org-silver-tier": "Silver",
      "org-gold-tier": "Gold",
    },
    current: {
      title: "Aktueller Tarif",
      plan: "Tarif",
      seatsLabel: "Benutzer",
      seats:
        "{{used}} von {{limit}} Plätzen belegt (Benutzer und offene Einladungen)",
      seatsUnlimited: "{{used}} Plätze belegt (ohne Begrenzung)",
    },
    unknownPlanTitle: "Unbekannter Tarif",
    unknownPlanDescription:
      "Diese Organisation hat den Tarif {{plan}}, den diese Version des Portals nicht kennt. Tarifänderungen sind deaktiviert, bis das Portal aktualisiert wird.",
    interval: {
      month: "Monatlich",
      year: "Jährlich",
    },
    pricePeriod: {
      month: "pro Monat",
      year: "pro Jahr",
    },
    billingIntervalLabel: "Abrechnungszeitraum",
    annualSaving: "Ein Monat gratis",
    pricingNote:
      "Preise gelten pro Organisation, nicht pro Benutzer, und enthalten Steuern.",
    introductoryPricing: "Einführungspreis",
    fossNote:
      "Kostenpflichtige Tarife finanzieren die Entwicklung von Vetchium, einem freien Open-Source-Projekt.",
    planCardLabel: "Tarif {{plan}}",
    featuresTitle: "Enthalten",
    descriptions: {
      "org-free-tier": "Für kleine Teams, die mit der Personalsuche beginnen.",
      "org-silver-tier":
        "Für wachsende Teams, die regelmäßig unter eigener Marke einstellen.",
      "org-gold-tier":
        "Für größere Organisationen, die in großem Umfang einstellen, mit KI-Unterstützung und Google-Anmeldung.",
    },
    currentBadge: "Aktuell",
    freePrice: "Kostenlos",
    freePriceCaption: "immer",
    comingSoon: "Demnächst",
    yes: "Enthalten",
    no: "Nicht enthalten",
    features: {
      users: "Bis zu {{count}} Benutzer",
      usersWithGoogle:
        "Bis zu {{count}} Benutzer, unbegrenzt mit Google-Anmeldung",
      openings: "{{count}} Stellenausschreibungen pro Jahr",
      logo: "Logo der Organisation",
      googleSignIn: "Google-Anmeldung",
      ticketSupport: "Support per Ticket",
      mcp: "MCP-Unterstützung",
      aiCredits: "{{count}} KI-Guthabenpunkte pro Monat",
      listings: "Angebote im Marktplatz",
    },
    comparison: {
      feature: "Funktion",
      users: "Benutzer",
      openings: "Stellenausschreibungen pro Jahr",
      logo: "Logo der Organisation",
      googleSignIn: "Google-Anmeldung",
      ai: "KI-Unterstützung",
      listings: "Angebote im Marktplatz",
      ticketSupport: "Support per Ticket",
      mcp: "MCP-Unterstützung",
    },
    actions: {
      current: "Aktueller Tarif",
      upgrade: "Upgrade",
      switchToFree: "Zu Free wechseln",
      interval: "Abrechnungsintervall ändern",
      downgrade: "Herabstufen",
    },
    confirmTitle: "Zu {{plan}} wechseln?",
    confirmBack: "Zurück",
    lockedSuspended:
      "Der Tarif kann nicht geändert werden, solange die Organisation gesperrt ist.",
    change: "Tarif ändern",
    back: "Zurück zur Abrechnung",
    development:
      "Entwicklung: Diese Preise werden noch nicht berechnet. Tarifwechsel sind kostenlos und gelten sofort.",
    compare: "Alle Funktionen vergleichen",
    immediate: "Diese Änderung gilt sofort. Es wird nichts berechnet.",
    changed: "Tarif aktualisiert",
    losesLogo:
      "Ihr Logo wird entfernt. Ein späteres Upgrade stellt es nicht wieder her.",
    losesGoogle:
      "Die Google-Anmeldung wird deaktiviert. Ein späteres Upgrade aktiviert sie nicht wieder.",
    excessSeats:
      "{{used}} Plätze sind belegt; der Zieltarif erlaubt {{limit}}. Deaktivieren Sie zuerst Benutzer oder stornieren Sie Einladungen.",
  },
  settings: {
    documentTitle: "Unternehmen | Vetchium",
    title: "Unternehmen",
    description: "Verwalten Sie den Namen und das Logo Ihres Unternehmens.",
    logo: {
      title: "Logo",
      help: "Wird neben dem Namen Ihrer Organisation angezeigt. Verwenden Sie ein nicht animiertes PNG oder JPEG bis 2 MiB, dessen Seiten jeweils zwischen 128 und 4.096 Pixel lang sind. Das Bild wird neu kodiert und seine Metadaten werden entfernt.",
      none: "Es ist kein Logo festgelegt.",
      alt: "Logo von {{name}}",
      upload: "Logo hochladen",
      replace: "Logo ersetzen",
      remove: "Logo entfernen",
      upgrade: "Ein Logo erfordert den Tarif Silver oder höher.",
      seePlans: "Tarife ansehen",
    },
    google: {
      title: "Google-Anmeldung",
      help: "Ihre Benutzer können sich mit ihren Google-Workspace-Konten anmelden. Es können sich nur Benutzer anmelden, die bereits zu dieser Organisation gehören, mit einer von Google bestätigten Adresse Ihrer Domain. Die Zwei-Faktor-Authentifizierung Ihres Google-Administrators ersetzt den Authenticator-Code, und Passwörter funktionieren weiter. Solange die Option aktiv ist, entfällt die Benutzergrenze.",
      on: "An",
      off: "Aus",
      upgrade: "Die Google-Anmeldung erfordert den Tarif Gold.",
      seePlans: "Tarife ansehen",
    },
  },
  roles: {
    superadmin: "Superadmin",
    finance: "Finanzen",
    userManager: "Benutzerverwaltung",
    recruiter: "Recruiter",
    hiringApprover: "Freigabe für Stellenanzeigen",
    vendorManager: "Anbieterverwaltung",
    providerStaff: "Dienstleister-Team",
    member: "Mitglied",
    custom: "Benutzerdefiniert",
  },
  users: {
    documentTitle: "Mitglieder | Vetchium für Organisationen",
    title: "Personen",
    description:
      "Laden Sie Personen ein, legen Sie fest, was sie tun dürfen, und schalten Sie Konten ab, wenn sie gehen.",
    tabs: {
      members: "Mitglieder",
      invitations: "Einladungen",
    },
    role: "Rolle",
    roleOf: "Rolle von {{email}}",
    permissionGranted: "Erteilt",
    you: "Sie",
    never: "Nie",
    actionsFor: "Aktionen für {{email}}",
    searchPlaceholder: "Nach E-Mail-Adresse suchen",
    clearFilters: "Filter zurücksetzen",
    page: "Seite {{page}}",
    empty: {
      default: "Noch keine Mitglieder.",
      filtered: "Keine Mitglieder passen zu diesen Filtern.",
    },
    columns: {
      state: "Status",
      joined: "Beigetreten",
      lastSignIn: "Letzte Anmeldung",
      actions: "Aktionen",
    },
    state: {
      active: "Aktiv",
      disabledManual: "Deaktiviert",
      "disabled-manual": "Deaktiviert",
    },
    filters: {
      state: "Status",
      role: "Rolle",
    },
    filterState: {
      active: "Aktiv",
      "disabled-manual": "Deaktiviert",
    },
    sort: {
      label: "Sortieren nach",
      email: "E-Mail-Adresse",
      joined: "Beitrittsdatum",
      ascending: "Aufsteigend",
      descending: "Absteigend",
    },
    summary: {
      seats:
        "{{used}} von {{limit}} Plätzen belegt (Mitglieder und offene Einladungen)",
      seatsUnlimited: "{{used}} Plätze belegt (ohne Begrenzung)",
      roles: "Rollen:",
      states: "Status:",
      role: {
        superadmin: "{{count}} Superadmin",
        finance: "{{count}} Finanzen",
        userManager: "{{count}} Benutzerverwaltung",
        member: "{{count}} Mitglieder",
      },
      state: {
        active: "{{count}} aktiv",
        "disabled-manual": "{{count}} deaktiviert",
      },
    },
    bulk: {
      selected: "{{count}} ausgewählt",
      limit: "Es können höchstens {{count}} auf einmal ausgewählt werden.",
      setRole: "Rolle festlegen",
      disable: "Deaktivieren",
      enable: "Aktivieren",
      clear: "Auswahl aufheben",
    },
    roleChange: {
      confirm: "Die {{count}} ausgewählten Benutzer zu „{{role}}“ machen?",
      effect:
        "Die neue Rolle gilt ab der nächsten Anfrage. Anmeldungen bleiben bestehen.",
      action: "Rolle ändern",
      saved: "Die Rolle wurde geändert.",
    },
    disable: {
      confirm: "{{count}} Benutzer deaktivieren?",
      effect:
        "Sie werden sofort abgemeldet und können sich erst nach der Reaktivierung wieder anmelden. Ihr Platz wird frei.",
      action: "Deaktivieren",
      done: "Die Benutzer wurden deaktiviert.",
    },
    enable: {
      confirm: "{{count}} Benutzer aktivieren?",
      effect: "Sie können sich wieder anmelden. Jeder belegt einen Platz.",
      action: "Aktivieren",
      done: "Die Benutzer wurden aktiviert.",
    },
    custom: {
      option: "Benutzerdefiniert …",
      edit: "Berechtigungen bearbeiten …",
      title: "Benutzerdefinierte Berechtigungen",
      hint: "Legen Sie genau fest, was dieser Benutzer tun darf. Eine Rolle ist nur eine Abkürzung für eine Auswahl davon.",
    },
    invite: {
      open: "Personen einladen",
      title: "Personen einladen",
      action: "Einladungen senden",
      addresses: "E-Mail-Adressen",
      addressesHelp:
        "Fügen Sie Adressen getrennt durch Kommas, Leerzeichen oder Zeilenumbrüche ein oder wählen Sie eine CSV-Datei. Sie müssen zur Domain Ihrer Organisation gehören.",
      chooseFile: "CSV-Datei wählen",
      count: "{{count}} Adressen",
      batches: "Wird in {{count}} Anfragen mit je bis zu 100 gesendet.",
      results: "{{invited}} von {{total}} Einladungen wurden gesendet.",
      outcome: "Ergebnis",
      outcomes: {
        invited: "Eingeladen",
        "already-member": "Bereits Mitglied",
        "already-invited": "Bereits eingeladen",
        "domain-mismatch": "Nicht in Ihrer Domain",
        invalid: "Keine E-Mail-Adresse",
      },
    },
    export: {
      action: "CSV exportieren",
      progress: "{{count}} exportiert …",
      failed: "Der Export konnte nicht abgeschlossen werden.",
    },
  },
  invitations: {
    search: "Einladungen nach E-Mail-Adresse suchen",
    empty: "Keine offenen Einladungen.",
    invitedBy: "Eingeladen von",
    expires: "Läuft ab",
    expired: "Abgelaufen",
    resend: "Erneut senden",
    resendFor: "Einladung an {{email}} erneut senden",
    resent: "Die Einladung wurde erneut gesendet.",
    cancelAction: "Widerrufen",
    cancelFor: "Einladung an {{email}} widerrufen",
    cancelSelected: "Ausgewählte widerrufen",
    cancelConfirm: "{{count}} Einladung(en) widerrufen?",
    cancelEffect:
      "Die Links in diesen E-Mails funktionieren nicht mehr und die Plätze werden frei.",
    cancelled: "Die Einladungen wurden widerrufen.",
  },
  acceptInvitation: {
    documentTitle: "Einladung annehmen | Vetchium für Organisationen",
    title: "Ihrer Organisation beitreten",
    missingToken:
      "Dieser Einladungslink ist unvollständig. Öffnen Sie den vollständigen Link aus der E-Mail.",
    expires: "Die Einladung läuft ab",
    action: "Konto erstellen",
    success: "Ihr Konto ist bereit. Melden Sie sich an, um fortzufahren.",
  },
  notFound: {
    title: "Seite nicht gefunden",
    description: "Die angeforderte Seite existiert nicht.",
    action: "Zur Startseite",
  },
  company: {
    identity: "Unternehmensidentität",
    name: "Unternehmensname",
    saved: "Unternehmensdaten gespeichert",
    country: "Land",
    countryHelp:
      "Wo das Unternehmen seinen Sitz hat. Neue Stellenanzeigen übernehmen es als Land der Beschäftigung.",
    defaultLanguage: "Standardsprache",
    defaultLanguageHelp:
      "Wird für Einladungen und als Ausgangssprache neuer Stellenanzeigen verwendet. Jedes Mitglied erhält eigene E-Mails weiterhin in seiner eigenen Sprache.",
    invalidName: "Geben Sie einen Namen mit 1 bis 200 Zeichen ein.",
    securityTitle: "Organisationssicherheit | Vetchium",
    confirmGoogle: "Google-Anmeldung ändern?",
    enableGoogle:
      "Mitglieder können sich mit ihren Google-Workspace-Konten anmelden. Es gelten die Sicherheitsrichtlinien von Workspace.",
    disableGoogle:
      "Mitglieder benötigen ihr Passwort und gegebenenfalls die Zwei-Faktor-Authentifizierung zur Anmeldung.",
  },
  people: {
    manage: "Verwalten",
    member: "Mitgliedsdetails",
    self: "Sie können Ihren eigenen Zugriff nicht ändern.",
    restricted: "Nur ein Superadmin kann geschützte Berechtigungen ändern.",
    approvalRestricted:
      "Nur ein Superadmin kann die Freigabe von Stellenanzeigen erteilen oder entziehen.",
    selection:
      "Nur angekreuzte Zeilen sind ausgewählt, auch auf anderen Seiten. Höchstens {{count}}.",
    full: "Alle Plätze sind belegt. Deaktivieren Sie einen Benutzer oder stornieren Sie eine Einladung, bevor Sie weitere Personen einladen.",
  },
  openings: {
    intro:
      "Erstellen Sie Stellenanzeigen, reichen Sie sie zur Genehmigung ein und behalten Sie alle Stellenanzeigen Ihrer Organisation im Blick.",
    breadcrumbOpening: "{{title}} #{{number}}",
    pendingTag: "Ausstehend: {{kind}}",
    columns: { opening: "Stellenanzeige" },
    tabs: {
      all: "Alle",
      withCount: "{{state}} ({{count}})",
      overview: "Übersicht",
      pipeline: "Pipeline",
      applicants: "Bewerbungen",
      candidates: "Kandidaten",
    },
    stats: {
      quota: "Kontingent für Stellenanzeigen",
      published: "Veröffentlicht",
      publishedHelp: "Jetzt für Bewerbende auf Vetchium sichtbar.",
      review: "Anfragen prüfen",
      showAll: "Alle Stellenanzeigen anzeigen",
      newApplicants: "Neue Bewerbungen",
      candidates: "Kandidaten",
      hired: "Eingestellt",
      ofPositions: "/ {{count}}",
      positionsLabel_one: "Stelle",
      positionsLabel_other: "Stellen",
      overHired: "Mehr Personen sind eingetreten als geplant.",
    },
    documentTitle: "Stellenanzeigen | Vetchium",
    title: "Stellenanzeigen",
    new: "Neue Stellenanzeige",
    untitled: "Entwurf ohne Titel",
    empty: "Für diese Filter sind keine Stellenanzeigen verfügbar.",
    quota:
      "In den letzten 365 Tagen erstellte Stellenanzeigen: {{used}} von {{limit}}",
    fields: {
      title: "Titel",
      description: "Beschreibung",
      language: "Sprache",
      state: "Status",
      country: "Beschäftigungsland",
      hiringManager: "Einstellungsverantwortliche Person",
      updated: "Aktualisiert",
      workArrangement: "Arbeitsmodell",
      locationDetails: "Standortdetails",
      remoteEligibility: "Remote-Berechtigung",
      employmentType: "Beschäftigungsart",
      positions: "Stellen",
      experienceYears: "Erfahrung in Jahren",
      minimumEducation: "Mindestabschluss",
      salary: "Gehalt",
    },
    filters: {
      more: "Weitere Filter",
      awaitingActive:
        "Angezeigt werden Stellenanzeigen mit einer Anfrage, die auf Ihre Genehmigung wartet.",
      pendingKinds: "Ausstehende Antragsarten",
      awaitingApproval: "Wartet auf meine Genehmigung",
      hiringManager: "E-Mail der einstellungsverantwortlichen Person",
      recruiter: "E-Mail der rekrutierenden Person",
      title: "Titel suchen",
      clear: "Filter löschen",
    },
    states: {
      draft: "Entwurf",
      discarded: "Verworfen",
      published: "Veröffentlicht",
      paused: "Pausiert",
      closed: "Geschlossen",
      expired: "Abgelaufen",
    },
    requestKinds: {
      publish: "Veröffentlichen",
      revise: "Überarbeiten",
      pause: "Pausieren",
      reopen: "Wieder öffnen",
      close: "Schließen",
    },
    requestStates: {
      pending: "Ausstehend",
      approved: "Genehmigt",
      rejected: "Abgelehnt",
      withdrawn: "Zurückgezogen",
      superseded: "Ersetzt",
      cancelled: "Storniert",
    },
    workArrangements: {
      on_site: "Vor Ort",
      hybrid: "Hybrid",
      remote: "Remote",
    },
    employmentTypes: {
      full_time: "Vollzeit",
      part_time: "Teilzeit",
      contract: "Vertrag",
      internship: "Praktikum",
    },
    remote: { worldwide: "Weltweit", countries: "Ausgewählte Länder" },
    education: {
      secondary: "Sekundarabschluss",
      bachelor: "Bachelor",
      master: "Master",
      doctorate: "Promotion",
    },
    salaryPeriods: {
      hour: "pro Stunde",
      day: "pro Tag",
      month: "pro Monat",
      year: "pro Jahr",
    },
    experienceRange: "{{min}}–{{max}} Jahre",
    experienceMin: "Ab {{min}} Jahren",
    experienceMax: "Bis {{max}} Jahre",
    editTitle: "Stellenanzeige bearbeiten",
    newTitle: "Neue Stellenanzeige",
    detailTitle: "Stellenanzeige #{{number}} | Vetchium",
    saved: "Inhalt gespeichert.",
    created: "Entwurf erstellt.",
    discardedWorking: "Arbeitskopie verworfen.",
    discardedDraft: "Entwurf verworfen.",
    revision: "Revision",
    expiresAt: "Läuft ab",
    pendingRequest: "Ausstehender Antrag",
    publicationMissing: "Füllen Sie vor der Veröffentlichung diese Felder aus:",
    actions: {
      title: "Aktionen für Stellenanzeigen",
      effects: {
        publish: "Veröffentlichen",
        revise: "Überarbeitung veröffentlichen",
        pause: "Pausieren",
        reopen: "Wieder öffnen",
        close: "Schließen",
      },
      submitForApproval: "Zur Genehmigung einreichen: {{action}}",
      submit: "Zur Genehmigung einreichen",
      approve: "Genehmigen",
      reject: "Ablehnen",
      withdraw: "Antrag zurückziehen",
      withdrawn: "Antrag zurückgezogen.",
      saved: "Stellenanzeige aktualisiert.",
      requestKind: "Beantragte Änderung",
      requester: "Beantragt von",
      requestedAt: "Beantragt am",
      note: "Notiz",
      optionalNote: "Optionale Notiz hinzufügen (bis zu 2.000 Zeichen).",
      rejectNote: "Geben Sie einen Grund für die Ablehnung an.",
      openApplications: "Bewerbungen",
      applicationsMarked: "Als nicht weiterverfolgt markiert",
      applicationsKept:
        "Offen gelassen, damit die Einstellung abgeschlossen werden kann",
      markNotProgressing_one:
        "Auch die {{count}} offene Bewerbung als nicht weiterverfolgt markieren ({{applicants}} Bewerbungen, {{candidates}} Kandidaten)",
      markNotProgressing_other:
        "Auch die {{count}} offenen Bewerbungen als nicht weiterverfolgt markieren ({{applicants}} Bewerbungen, {{candidates}} Kandidaten)",
      markNotProgressingHelp:
        "Die Personen sehen in Vetchium „Nicht weiterverfolgt“. Bevorstehende Interviews werden abgesagt und gemachte Angebote zurückgezogen. Lassen Sie dies aus, um mit den bereits laufenden Verfahren weiter einzustellen.",
      approveMarksApplications:
        "Mit der Genehmigung wird auch jede offene Bewerbung als nicht weiterverfolgt markiert.",
      consequences: {
        pause:
          "Während der Pause ist diese Stellenanzeige für Bewerbende nicht sichtbar.",
        close:
          "Schließen beendet diese Stellenanzeige dauerhaft. Für eine neue Einstellung duplizieren Sie sie als Entwurf.",
      },
    },
    publicURL: "Öffentliche Hub-URL",
    copyURL: "URL kopieren",
    copied: "URL kopiert.",
    copyFailed: "Die URL konnte nicht kopiert werden.",
    liveContent: "Veröffentlichter Inhalt",
    draftContent: "Entwurfsinhalt",
    workingContent: "Arbeitskopie",
    notSet: "Nicht festgelegt",
    notFound: "Stellenanzeige nicht gefunden oder nicht verfügbar.",
    edit: "Bearbeiten",
    editTeam: "Team und Notizen bearbeiten",
    duplicate: "Duplizieren",
    discardDraft: "Entwurf verwerfen",
    discardWorking: "Arbeitskopie verwerfen",
    confirmDiscardDraft: "Diesen Entwurf und seinen Inhalt verwerfen?",
    confirmDiscardWorking:
      "Diese Arbeitskopie verwerfen? Der veröffentlichte Inhalt bleibt bestehen.",
    disabledMember: "Deaktiviert",
    history: "Verlauf",
    systemActor: "System",
    editor: {
      optional: "Optional",
      newIntro:
        "Beschreiben Sie die Stelle für Bewerbende. Sie können einen unvollständigen Entwurf speichern und später fertigstellen.",
      editIntro:
        "Bearbeiten Sie diese Stellenanzeige. Wechseln Sie zur Vorschau für Bewerbende, um sie so zu sehen wie Bewerbende.",
      tabs: { edit: "Bearbeiten" },
      sections: {
        basics: "Grundlagen",
        location: "Standort",
        role: "Stelle und Anforderungen",
      },
      help: {
        title:
          "Die Stellenbezeichnung, nach der Bewerbende suchen, etwa Backend-Entwicklung.",
        description:
          "Markdown wird unterstützt: Überschriften, Listen, Fett- und Kursivschrift sowie Links. Das Ergebnis zeigt die Vorschau für Bewerbende.",
        language: "Die Sprache, in der diese Stellenanzeige verfasst ist.",
        country: "Das Land, in dem die eingestellte Person beschäftigt wird.",
        remoteEligibility:
          "Wo Bewerbende wohnen dürfen. Eine Länderliste muss das Beschäftigungsland enthalten.",
        locationDetails: "Optional. Stadt, Büroadresse oder Reiseerwartungen.",
        positions: "Wie viele Personen Sie einstellen, von 1 bis 10.",
        salary:
          "Optional. Um ein Gehalt anzuzeigen, füllen Sie alle vier Felder aus; andernfalls lassen Sie alle leer.",
        hiringManager:
          "Zum Veröffentlichen erforderlich. Muss ein aktives Mitglied Ihrer Organisation sein.",
        recruiter:
          "Zum Veröffentlichen erforderlich. Darf dieselbe Person wie die einstellungsverantwortliche Person sein.",
        teamMembers:
          "Optional. Bis zu 20 aktive Mitglieder, die bei dieser Stellenanzeige helfen.",
        internalNotes:
          "Nur Ihre Organisation sieht diese Notizen, Bewerbende nie.",
      },
      previewHelp:
        "So sehen Bewerbende diese Stellenanzeige, sobald sie veröffentlicht ist.",
      previewEmpty:
        "Noch nichts in der Vorschau. Fügen Sie im Tab Bearbeiten einen Titel und eine Beschreibung hinzu.",
      actions: {
        title: "Aktionen",
        newHelp:
          "Ein Entwurf belegt einen Platz Ihres Kontingents für Stellenanzeigen. Entwürfe bleiben innerhalb Ihrer Organisation.",
        draftHelp:
          "Speichern aktualisiert diesen Entwurf. Bewerbende sehen nichts, bis er veröffentlicht ist.",
        revisionHelp:
          "Änderungen werden als Revision gespeichert. Bewerbende sehen weiter die veröffentlichte Fassung, bis die Revision veröffentlicht ist.",
        nextStep:
          "Veröffentlichen Sie die Stellenanzeige nach dem Speichern auf ihrer Seite oder reichen Sie sie dort zur Genehmigung ein.",
      },
      checklist: {
        title: "Checkliste zur Veröffentlichung",
        progress: "{{done}}/{{total}}",
        help: "Sie können jederzeit speichern. Zum Veröffentlichen ist jeder Punkt unten nötig.",
        ready: "Alles für die Veröffentlichung ist vorhanden.",
        done: "Erledigt",
        missing: "Nicht erledigt",
      },
      team: "Einstellungsteam und Notizen",
      recruiter: "Rekrutierende Person",
      teamMembers: "Teammitglieder",
      internalNotes: "Interne Notizen",
      minimumYears: "Mindestjahre",
      maximumYears: "Höchstjahre",
      currency: "Währung",
      salaryMin: "Mindestgehalt",
      salaryMax: "Höchstgehalt",
      salaryPeriod: "Gehaltszeitraum",
      preview: "Vorschau für Bewerbende",
      save: "Speichern",
      createDraft: "Entwurf erstellen",
    },
    errors: {
      versionConflict:
        "Diese Stellenanzeige wurde geändert. Die neueste Version wurde geladen. Prüfen Sie sie und versuchen Sie es erneut.",
      quota:
        "Das Kontingent ist ausgeschöpft: {{count}} von {{quota}} Plätzen sind belegt.",
      invalidTeam:
        "Diese Adressen gehören keinen aktiven Mitgliedern dieser Organisation: {{addresses}}.",
      invalidField: "Prüfen Sie dieses Feld.",
      incomplete:
        "Diese Stellenanzeige ist unvollständig. Füllen Sie diese Felder aus und versuchen Sie es erneut:",
      notEditable:
        "Diese Stellenanzeige kann in ihrem aktuellen Zustand nicht bearbeitet werden.",
      contentLocked:
        "Der Inhalt ist während eines ausstehenden Veröffentlichungs- oder Änderungsantrags gesperrt. Ziehen Sie den Antrag zurück, um ihn zu bearbeiten.",
    },
    historyActions: {
      created: "Erstellt",
      duplicated: "Dupliziert",
      working_copy_saved: "Arbeitskopie gespeichert",
      team_changed: "Team geändert",
      pipeline_changed: "Pipeline geändert",
      revision_discarded: "Revision verworfen",
      discarded: "Verworfen",
      requested: "Beantragt",
      approved: "Genehmigt",
      self_approved: "Vom Antragsteller genehmigt",
      rejected: "Abgelehnt",
      withdrawn: "Zurückgezogen",
      superseded: "Ersetzt",
      cancelled: "Storniert",
      expired: "Abgelaufen",
    },
  },
  applications: {
    removedApplicant: "Entfernte Bewerberin bzw. entfernter Bewerber",
    optional: "Optional",
    search: "Nach Namen suchen",
    searchTooShort_one: "Geben Sie mindestens {{count}} Zeichen ein.",
    searchTooShort_other: "Geben Sie mindestens {{count}} Zeichen ein.",
    clearFilters: "Filter zurücksetzen",
    noMatches: "Keine Bewerbung entspricht diesen Filtern.",
    applicantsIntro:
      "Personen, die sich beworben haben und auf eine erste Entscheidung warten. In die engere Wahl genommene Personen wechseln als Kandidaten in Ihre Pipeline.",
    applicantsReadOnly:
      "Personen, die sich beworben haben und auf eine erste Entscheidung warten. Nur die Einstellungsverantwortlichen, die Recruiter und Personen mit Zugriff auf Kandidaturen können sie in die engere Wahl nehmen.",
    applicantsEmpty:
      "Niemand wartet auf eine Entscheidung. Neue Bewerbungen erscheinen hier.",
    candidatesEmpty:
      "Noch keine Kandidaten. Nehmen Sie eine Bewerbung in die engere Wahl, um die Pipeline zu starten.",
    finishedEmpty: "Hier gibt es keine Bewerbungen.",
    stageCards: "Kandidaten nach Phase",
    allActive: "Alle aktiven",
    active: "Aktiv",
    viewWithCount: "{{state}} ({{count}})",
    noStage: "Keine Phase",
    stateCaptions: {
      offered: "Wartet auf Kandidat",
      offer_accepted: "Eintritt erfassen",
    },
    states: {
      submitted: "Beworben",
      in_pipeline: "In der Pipeline",
      offered: "Angebot gemacht",
      offer_accepted: "Angebot angenommen",
      offer_declined: "Angebot abgelehnt",
      joined: "Eingetreten",
      did_not_join: "Nicht eingetreten",
      not_progressing: "Nicht weiterverfolgt",
      withdrawn: "Zurückgezogen",
    },
    stageKinds: {
      review: "Prüfung",
      assessment: "Assessment",
      interview: "Interview",
      background_check: "Hintergrundprüfung",
    },
    columns: {
      applicant: "Bewerbung von",
      application: "Bewerbung",
      applied: "Beworben",
      actions: "Aktionen",
      candidate: "Kandidat",
      stage: "Phase",
      status: "Status",
      updated: "Aktualisiert",
    },
    pending: {
      label: "Wartet auf Kandidat",
      interview_response: "Antwort zum Interview",
      background_check_consent: "Einwilligung zur Hintergrundprüfung",
      offer_response: "Antwort zum Angebot",
    },
    tabs: {
      applicants: "Bewerbungen",
      candidates: "Kandidaten",
    },
    notFound:
      "Diese Bewerbung wurde nicht gefunden oder Sie dürfen sie nicht lesen.",
    backToOpening: "Zurück zur Stelle",
    detailTitle: "{{name}} | Vetchium",
    applicationNumber: "Bewerbung Nr. {{number}}",
    appliedOn: "Beworben am {{date}}",
    coverNote: "Anschreiben",
    overHired:
      "{{joined}} Personen sind eingetreten, geplant waren {{positions}} Stellen. Mehr einzustellen als geplant ist erlaubt.",
    errors: {
      versionConflict:
        "Diese Bewerbung hat sich geändert, seit Sie sie geöffnet haben. Sie wurde neu geladen; prüfen Sie sie und versuchen Sie es erneut.",
      stateConflict:
        "Der Status der Bewerbung erlaubt diese Aktion nicht mehr. Sie wurde neu geladen.",
      notFound:
        "Diese Bewerbung wurde nicht gefunden oder Sie dürfen sie nicht lesen.",
      permissionRequired:
        "Das dürfen nur die Einstellungsverantwortlichen der Stelle, ihre Recruiter und Personen mit Zugriff auf Kandidaturen.",
      invalidStage: "Diese Phase ist für diese Bewerbung nicht verfügbar.",
      invalidDate:
        "Dieses Datum ist nicht zulässig. Prüfen Sie es gegen das Angebot und die übrigen Daten.",
      interviewNotFound:
        "Dieses Interview existiert in der Bewerbung nicht mehr. Die Ansicht wurde neu geladen.",
      interviewStateConflict:
        "Status oder Zeitpunkt des Interviews erlauben diese Aktion nicht mehr. Die Ansicht wurde neu geladen.",
      feedbackExists: "Sie haben zu diesem Interview bereits Feedback gegeben.",
      interviewLimit:
        "Eine Stufe enthält höchstens {{count}} Interviews. Sagen Sie eines ab, bevor Sie ein weiteres planen.",
      interviewersInvalid:
        "Diese Personen sind keine aktiven Nutzer Ihrer Organisation: {{emails}}.",
      letterInvalid: "Das Angebotsschreiben muss eine PDF-Datei sein.",
      letterTooLarge: "Das Angebotsschreiben darf höchstens 5 MB groß sein.",
      letterConflict:
        "Dieses Angebotsschreiben wurde bereits für ein anderes Angebot verwendet. Wählen Sie die Datei erneut aus.",
      invalidStart: "Das Interview muss in der Zukunft beginnen.",
      invalidProposedDate:
        "Das vorgeschlagene Eintrittsdatum darf nicht in der Vergangenheit liegen.",
    },
    shortlist: {
      action: "In die engere Wahl",
      row: "{{name}} in die engere Wahl nehmen",
      title: "{{name}} in die engere Wahl nehmen",
      intro:
        "{{name}} wird Kandidat bzw. Kandidatin. Wählen Sie die Startphase.",
      stage: "Phase",
      confirm: "In die engere Wahl",
      done: "{{name}} ist jetzt Kandidat bzw. Kandidatin.",
      seesInReview: "{{name}} sieht „In Prüfung“. Phasennamen bleiben intern.",
      seesInterviewing:
        "{{name}} sieht „Im Interview“. Phasennamen bleiben intern.",
    },
    notProgressing: {
      action: "Nicht weiterverfolgen",
      row: "{{name}} als nicht weiterverfolgt markieren",
      title: "{{name}} als nicht weiterverfolgt markieren?",
      body: "{{name}} sieht in Vetchium „Nicht weiterverfolgt“ und die Bewerbung endet.",
      candidacy:
        "Bevorstehende Interviews werden abgesagt und ein gemachtes Angebot wird zurückgezogen.",
      final: "Das lässt sich nicht rückgängig machen.",
      confirm: "Nicht weiterverfolgen",
      done: "{{name}} ist als nicht weiterverfolgt markiert.",
    },
    actions: {
      title: "Aktionen",
      readOnly:
        "Sie können diese Bewerbung lesen, aber nicht bearbeiten. Das dürfen nur die Einstellungsverantwortlichen der Stelle, ihre Recruiter und Personen mit Zugriff auf Kandidaturen.",
      none: "Diese Bewerbung ist beendet, es gibt nichts mehr zu tun.",
      moveLabel: "In eine spätere Phase verschieben",
      choosePlaceholder: "Phase wählen",
      move: "Verschieben",
      moved: "In die neue Phase verschoben.",
      skipHelp: "Übersprungene Phasen werden als übersprungen markiert.",
      willSkip: "Überspringt: {{stages}}.",
      completeReview: "Prüfung als abgeschlossen markieren",
    },
    confirm: {
      "withdraw-offer": {
        action: "Angebot zurückziehen",
        title: "Angebot zurückziehen?",
        body: "Die Bewerbung kann nicht mehr antworten und kehrt zu ihrer Stufe zurück. Das Schreiben bleibt im Verlauf für Ihr Team erhalten.",
        confirm: "Angebot zurückziehen",
        done: "Angebot zurückgezogen.",
      },
      "complete-stage": {
        action: "Prüfung als abgeschlossen markieren",
        title: "Prüfung als abgeschlossen markieren?",
        body: "Damit wird „{{stage}}“ abgeschlossen. Verschieben Sie den Kandidaten danach weiter.",
        confirm: "Als abgeschlossen markieren",
        done: "Prüfung als abgeschlossen markiert.",
      },
      "did-not-join": {
        action: "Nicht eingetreten",
        title: "Erfassen, dass die Person nicht eingetreten ist?",
        body: "Die Person hat das Angebot angenommen, ist aber nicht eingetreten. Die Bewerbung endet.",
        confirm: "Nicht eingetreten",
        done: "Als nicht eingetreten erfasst.",
      },
    },
    dates: {
      saved: "Datum gespeichert.",
      joinedOn: "Eingetreten am",
      separatedOn: "Ausgeschieden am",
      utc: "Daten sind UTC-Kalendertage.",
      overHiring:
        "{{joined}} von {{positions}} geplanten Stellen sind bereits besetzt. Eine weitere eingetretene Person bedeutet mehr Einstellungen als geplant; das ist erlaubt.",
      "record-joined": {
        action: "Eintritt erfassen",
        title: "Eintrittsdatum erfassen",
        help: "Der erste Arbeitstag. Nicht in der Zukunft und nicht vor dem Tag, an dem das Angebot gemacht wurde.",
        confirm: "Eintritt erfassen",
      },
      "record-separated": {
        action: "Austritt erfassen",
        title: "Austrittsdatum erfassen",
        help: "Optional: der Tag des Ausscheidens. Nach dem Eintrittsdatum und innerhalb von 365 Tagen danach.",
        confirm: "Austritt erfassen",
      },
      "correct-joined": {
        action: "Eintrittsdatum korrigieren",
        title: "Eintrittsdatum korrigieren",
        help: "Sie können es bis 90 Tage nach der ersten Erfassung korrigieren. Der Verlauf behält jeden Wert.",
        confirm: "Datum speichern",
      },
      "correct-separated": {
        action: "Austrittsdatum korrigieren",
        title: "Austrittsdatum korrigieren",
        help: "Sie können es bis 90 Tage nach der ersten Erfassung korrigieren. Der Verlauf behält jeden Wert.",
        confirm: "Datum speichern",
      },
    },
    progress: {
      title: "Fortschritt",
      completed: "Abgeschlossen",
      skipped: "Übersprungen",
      current: "Aktuell",
      offer: "Angebot",
      accepted: "Angenommen",
      joined: "Eingetreten",
    },
    waiting: {
      title: "Wartet auf Kandidat",
      interview: "Interview {{number}} am {{start}}",
      consent: "Einwilligung zur Hintergrundprüfung in „{{stage}}“",
      offer: "Antwort auf das Angebot bis {{date}}",
    },
    snapshot: {
      title: "Profil bei der Bewerbung",
      removed:
        "Die Aufbewahrungsfrist ist abgelaufen, daher wurden die Daten dieser Person gelöscht.",
      country: "Wohnland",
      about: "Über mich",
      work: "Berufserfahrung",
      education: "Ausbildung",
      certifications: "Zertifikate",
      languages: "Sprachen",
      websites: "Websites",
      present: "heute",
      captured:
        "Erfasst am {{date}}, als die Person sich beworben hat. Spätere Profiländerungen erscheinen hier nicht.",
      abilities: {
        speaking: "sprechen",
        reading: "lesen",
        writing: "schreiben",
      },
    },
    history: {
      title: "Verlauf",
      more: "Mehr anzeigen",
      interview: "Interview {{number}}",
      actors: {
        applicant: "Bewerber",
        org_user: "Organisationsmitglied",
        system: "System",
      },
      actions: {
        applied: "Beworben",
        shortlisted: "In die engere Wahl genommen",
        stage_moved: "In eine Phase verschoben",
        offer_extended: "Angebot gemacht",
        offer_withdrawn: "Angebot zurückgezogen",
        offer_accepted: "Angebot angenommen",
        offer_declined: "Angebot abgelehnt",
        joined: "Eingetreten",
        did_not_join: "Nicht eingetreten",
        not_progressing: "Als nicht weiterverfolgt markiert",
        withdrawn: "Vom Bewerber zurückgezogen",
        stage_completed: "Phase abgeschlossen",
        separated: "Austritt erfasst",
        joined_corrected: "Eintrittsdatum korrigiert",
        separated_corrected: "Austrittsdatum korrigiert",
        interview_scheduled: "Interview angesetzt",
        interview_changed: "Interview geändert",
        interview_cancelled: "Interview abgesagt",
        interview_completed: "Interview durchgeführt",
        interview_no_show: "Interview nicht wahrgenommen",
        interview_accepted: "Interview vom Bewerber angenommen",
        interview_reschedule_requested: "Bewerber bat um einen anderen Termin",
        interview_feedback_submitted: "Interview-Feedback abgegeben",
        assessment_recorded: "Assessment-Ergebnis erfasst",
        background_check_consent_requested:
          "Einwilligung zur Hintergrundprüfung angefragt",
        background_check_consent_given:
          "Einwilligung zur Hintergrundprüfung erteilt",
        background_check_consent_declined:
          "Einwilligung zur Hintergrundprüfung abgelehnt",
        background_check_result_recorded:
          "Ergebnis der Hintergrundprüfung erfasst",
        routed: "Aufgabe zugewiesen",
        removed: "Bewerberdaten entfernt",
      },
    },
    interview: {
      atStage: "Stufe: {{stage}}",
      start: "Beginn",
      startHelp:
        "In Ihrer Zeitzone ({{zone}}). Die Bewerbung sieht die Zeit in der eigenen Zeitzone.",
      startPast: "Wählen Sie einen Zeitpunkt in der Zukunft.",
      duration: "Dauer",
      minutes: "Minuten",
      videoUrl: "Meeting-Link",
      videoUrlHelp:
        "Ein https-Link, über den die Bewerberin bzw. der Bewerber beitritt.",
      location: "Ort",
      locationHelp:
        "Wohin die Bewerberin bzw. der Bewerber kommen soll, zum Beispiel Adresse und Etage.",
      interviewersHelp:
        "Aktive Nutzer Ihrer Organisation, per E-Mail-Adresse. Bis zu {{max}}; sie können diese Bewerbung lesen und Feedback geben.",
      interviewersPlaceholder: "E-Mail-Adresse eingeben oder auswählen",
      limitReached:
        "Diese Stufe enthält bereits {{count}} Interviews. Sagen Sie eines ab, um ein weiteres zu planen.",
      schedule: {
        action: "Interview planen",
        title: "Interview planen",
        confirm: "Planen",
        done: "Interview geplant. Die Bewerbung wird um eine Antwort gebeten.",
      },
      change: {
        action: "Ändern",
        title: "Interview ändern",
        confirm: "Änderungen speichern",
        done: "Interview aktualisiert. Bei neuer Zeit oder neuem Ort wird erneut um eine Antwort gebeten.",
      },
      cancel: {
        action: "Interview absagen",
        title: "Interview {{number}} absagen?",
        body: "Die Bewerbung sieht das Interview als abgesagt. Bereits gegebenes Feedback bleibt erhalten.",
        confirm: "Interview absagen",
        done: "Interview abgesagt.",
      },
      completed: {
        action: "Als durchgeführt markieren",
        title: "Interview {{number}} hat stattgefunden?",
        body: "Danach können die Interviewenden Feedback geben.",
        confirm: "Als durchgeführt markieren",
        done: "Interview als durchgeführt markiert.",
      },
      no_show: {
        action: "Als nicht erschienen markieren",
        title: "Bewerbung ist zu Interview {{number}} nicht erschienen?",
        body: "Das hält das Nichterscheinen fest. Die Bewerbung endet dadurch nicht.",
        confirm: "Als nicht erschienen markieren",
        done: "Interview als nicht wahrgenommen markiert.",
      },
    },
    feedback: {
      action: "Feedback geben",
      title: "Feedback zu Interview {{number}}",
      confirm: "Feedback senden",
      done: "Feedback gesendet. Sie können nun das Feedback der anderen Interviewenden lesen.",
      rule: "Das Feedback der anderen sehen Sie erst, nachdem Sie Ihres gesendet haben, damit es Sie nicht beeinflusst.",
      hidden:
        "Geben Sie Ihr Feedback, um das der anderen Interviewenden zu lesen.",
      recommendation: "Empfehlung",
      notes: "Notizen",
      notesHelp:
        "Was Sie gesehen haben und warum Sie dies empfehlen. Bis zu 10.000 Zeichen.",
      final:
        "Feedback lässt sich nur einmal senden und danach nicht mehr ändern.",
    },
    assessment: {
      action: "Testergebnis erfassen",
      title: "Testergebnis: {{stage}}",
      confirm: "Ergebnis erfassen",
      done: "Testergebnis erfasst. Die Stufe ist abgeschlossen.",
      outcome: "Ergebnis",
      help: "Das Erfassen schließt diese Stufe ab und lässt sich nicht wiederholen.",
      score: "Punktzahl (0–100)",
      notes: "Notizen",
      link: "Link zum Bericht",
      linkHelp:
        "Ein https-Link zum Bericht bei der Stelle, die den Test durchgeführt hat. Vetchium speichert keine Dateien.",
    },
    consent: {
      action: "Einwilligung für Hintergrundprüfung anfordern",
      againAction: "Erneut um Einwilligung bitten",
      title: "Einwilligung für Hintergrundprüfung anfordern",
      againTitle: "Erneut um Einwilligung für die Hintergrundprüfung bitten",
      confirm: "Anfrage senden",
      done: "Einwilligung angefordert. Die Bewerbung wird in Vetchium gefragt.",
      rule: "Es kann nichts erfasst werden, bevor die Bewerbung diesen Prüfungen in Vetchium zustimmt. Bei einer Ablehnung wird nichts erfasst, und Sie entscheiden, wie es weitergeht.",
      checks: "Prüfungen",
      noFiles:
        "Vetchium erfasst jedes Ergebnis und einen Link zum Bericht. Berichtsdateien werden nicht gespeichert.",
    },
    checkResult: {
      action: "Ergebnis erfassen",
      title: "Ergebnis: {{check}}",
      confirm: "Ergebnis erfassen",
      done: "Ergebnis für {{check}} erfasst.",
      outcome: "Ergebnis",
      link: "Link zum Bericht",
      linkHelp:
        "Ein https-Link zum Bericht bei der Stelle, die die Prüfung durchgeführt hat.",
    },
    offer: {
      action: "Angebot unterbreiten",
      title: "Angebot unterbreiten",
      confirm: "Angebot unterbreiten",
      done: "Angebot unterbreitet. Die Bewerbung wird um eine Antwort gebeten.",
      overHiring:
        "{{joined}} Personen sind bereits eingetreten bei {{positions}} geplanten Stellen. Sie können dieses Angebot trotzdem unterbreiten.",
      letter: "Angebotsschreiben",
      letterHelp:
        "Eine PDF-Datei bis 5 MB. Die Bewerbung liest sie in Vetchium.",
      chooseLetter: "PDF auswählen",
      replaceLetter: "Andere PDF auswählen",
      respondWithin: "Antwort innerhalb von",
      respondHelp:
        "Das Angebot verfällt, wenn bis dahin keine Antwort vorliegt.",
      days: "Tagen",
      joiningDate: "Vorgeschlagenes Eintrittsdatum",
      joiningHelp: "Optional. Ein Datum ab heute, in UTC.",
    },
    work: {
      interviews: "Interviews",
      interview: "Interview {{number}}",
      when: "Wann",
      whenValue: "{{start}} · {{minutes}} Min.",
      mode: "Art",
      modes: {
        video: "Videoanruf",
        in_person: "Vor Ort",
      },
      interviewers: "Interviewende",
      interviewerSubmitted: "{{email}} (Feedback abgegeben)",
      rescheduleNote: "Die Person bat um einen anderen Termin: „{{note}}“",
      feedbackBy: "{{email}}: {{recommendation}}",
      interviewStates: {
        scheduled: "Angesetzt",
        completed: "Durchgeführt",
        no_show: "Nicht erschienen",
        cancelled: "Abgesagt",
      },
      responses: {
        pending: "Antwort ausstehend",
        accepted: "Angenommen",
        reschedule_requested: "Anderer Termin gewünscht",
      },
      recommendations: {
        strong_yes: "Klares Ja",
        yes: "Ja",
        no: "Nein",
        strong_no: "Klares Nein",
      },
      assessments: "Assessments",
      outcomes: {
        pass: "Bestanden",
        fail: "Nicht bestanden",
        inconclusive: "Nicht eindeutig",
      },
      score: "Punktzahl {{score}}",
      report: "Bericht",
      recorded: "Erfasst am {{date}} von {{by}}",
      backgroundChecks: "Hintergrundprüfungen",
      consent: {
        requested: "Einwilligung angefragt",
        given: "Einwilligung erteilt",
        declined: "Einwilligung abgelehnt",
        ended: "Anfrage beendet",
      },
      checkTypes: {
        identity: "Identität",
        education: "Ausbildung",
        employment: "Beschäftigung",
        criminal: "Führungszeugnis",
        address: "Anschrift",
        credit: "Bonität",
        drug: "Drogentest",
      },
      checkOutcomes: {
        clear: "Unauffällig",
        discrepancy: "Abweichung",
        unable_to_verify: "Nicht überprüfbar",
      },
      checkPending: "Ausstehend",
      consentAwaited:
        "Wir warten auf die Antwort der Bewerberin bzw. des Bewerbers in Vetchium. Ergebnisse lassen sich nach der Einwilligung erfassen.",
      resultsNotDecided:
        "Vetchium erfasst Ergebnisse und entscheidet nie, was daraus folgt. Diese Entscheidung liegt bei Ihnen.",
      offers: "Angebote",
      offer: "Angebot {{number}}",
      offerStates: {
        extended: "Gemacht",
        accepted: "Angenommen",
        declined: "Abgelehnt",
        expired: "Abgelaufen",
        withdrawn: "Zurückgezogen",
      },
      letter: "Angebotsschreiben (PDF)",
      offerDates: "Gemacht am {{extended}} · Antwort bis {{respondBy}}",
      proposedJoining: "Vorgeschlagenes Eintrittsdatum: {{date}}",
    },
  },
  myInterviews: {
    documentTitle: "Meine Interviews | Vetchium",
    title: "Meine Interviews",
    description:
      "Interviews, an denen Sie teilnehmen, das neueste zuerst. Öffnen Sie eines, um die Bewerbung zu lesen und Feedback zu geben.",
    empty:
      "Sie sind noch bei keinem Interview als Interviewende bzw. Interviewender eingetragen.",
    minutes: "{{minutes}} Min.",
    columns: {
      applicant: "Bewerbung",
      when: "Wann",
      mode: "Art",
      state: "Status",
      feedback: "Ihr Feedback",
    },
    feedbackGiven: "Gesendet",
    feedbackDue: "Offen",
    feedbackNotYet: "Nach dem Interview",
  },
  pipeline: {
    title: "Pipeline",
    internal: "Intern",
    startFrom: "Starten mit",
    startFromHelp:
      "Die Stellenanzeige erhält eine eigene Kopie. Ihre Phasen lassen sich jederzeit im Tab „Pipeline“ der Stellenanzeige ändern.",
    defaultStart: "Eine Prüfungsphase",
    templateOption: "{{name}} · {{count}} Phasen",
    templatesLoadError:
      "Ihre Pipeline-Vorlagen konnten nicht geladen werden. Die Stellenanzeige startet mit einer Prüfungsphase.",
    stages: "Phasen",
    unsaved: "Nicht gespeicherte Änderungen",
    discard: "Verwerfen",
    save: "Pipeline speichern",
    saved: "Pipeline gespeichert.",
    intro:
      "Kandidaten durchlaufen diese Phasen der Reihe nach. Die Pipeline ist intern: Änderungen gelten sofort und brauchen keine Freigabe. Kandidaten sehen nur einen allgemeinen Status, nie Phasennamen.",
    readOnly:
      "Diese Stellenanzeige kann nicht mehr geändert werden, ihre Pipeline ist daher schreibgeschützt.",
    problems: {
      empty: "Eine Pipeline braucht mindestens eine Phase.",
      tooMany: "Eine Pipeline hat höchstens 15 Phasen.",
      name: "Geben Sie jeder Phase einen Namen mit 1 bis 100 Zeichen.",
    },
    errors: {
      inUse:
        "Einige entfernte Phasen enthalten Kandidaten, daher wurde die Pipeline nicht gespeichert. Verschieben Sie diese Kandidaten in eine andere Phase oder stellen Sie die Phasen wieder her.",
      versionConflict:
        "Diese Stellenanzeige hat sich seit dem Öffnen geändert. Ihre Änderungen bleiben erhalten; speichern Sie erneut, um sie auf die neueste Version anzuwenden.",
      unavailable:
        "Diese Stellenanzeige kann nicht mehr geändert werden, die Pipeline wurde daher nicht gespeichert.",
      unknownStage:
        "Eine Phase wurde anderswo entfernt. Verwerfen Sie Ihre Änderungen, um die aktuelle Pipeline zu laden.",
    },
    candidatesHere_one: "{{count}} Kandidat",
    candidatesHere_other: "{{count}} Kandidaten",
    removeHoldsCandidates:
      "„{{name}}“ kann nicht entfernt werden, solange sie Kandidaten enthält. Verschieben Sie diese zuerst in eine andere Phase oder stellen Sie die Phase wieder her.",
    removeRefused:
      "„{{name}}“ kann nicht entfernt werden, weil sie Kandidaten enthält. Verschieben Sie diese zuerst in eine andere Phase oder stellen Sie die Phase wieder her.",
    afterLast: "Nach der letzten Phase:",
    after: {
      offer: "Angebot",
      offerAccepted: "Angebot angenommen",
      joined: "Eingetreten",
    },
    offerAnywhere: "Ein Angebot können Sie aus jeder Phase machen.",
    stageName: "Name von Phase {{number}}",
    stageNameRemoved: "Name der entfernten Phase {{name}}",
    stageNamePlaceholder: "Phasenname",
    stageKind: "Art von Phase {{number}}",
    stageKindRemoved: "Art der entfernten Phase {{name}}",
    moveUp: "Phase {{number}} nach oben",
    moveDown: "Phase {{number}} nach unten",
    remove: "Phase {{number}} entfernen",
    restore: "Wiederherstellen",
    restoreStage: "Phase {{name}} wiederherstellen",
    addStage: "Phase hinzufügen",
    limitReached: "Eine Pipeline kann höchstens {{limit}} Phasen haben.",
    stageCount: "{{count}} von {{limit}} Phasen",
    minimumStage: "Eine Pipeline braucht mindestens eine Phase.",
    kinds: {
      review: "Prüfung",
      assessment: "Assessment",
      interview: "Interview",
      background_check: "Hintergrundprüfung",
    },
    actions: "Aktionen",
    template: {
      documentTitle: "Pipeline-Vorlagen | Vetchium",
      title: "Pipeline-Vorlagen",
      intro:
        "Gespeicherte Phasenlisten für neue Stellenanzeigen. Eine neue Stellenanzeige kopiert eine Vorlage; spätere Änderungen an der Vorlage ändern keine Stellenanzeigen, die sie genutzt haben.",
      new: "Neue Vorlage",
      newTitle: "Neue Vorlage",
      editTitle: "Vorlage bearbeiten",
      name: "Name",
      nameHelp: "In Ihrer Organisation eindeutig.",
      nameRequired: "Geben Sie einen Vorlagennamen mit 1 bis 100 Zeichen ein.",
      stageNameRequired:
        "Geben Sie jeder Phase einen Namen mit 1 bis 100 Zeichen.",
      nameTaken: "Eine andere Vorlage hat bereits diesen Namen.",
      limit:
        "Ihre Organisation hat bereits die maximale Zahl an Vorlagen ({{limit}}). Löschen Sie eine, um eine weitere anzulegen.",
      gone: "Diese Vorlage existiert nicht mehr. Laden Sie die Seite neu.",
      stagesHelp:
        "1 bis 15 Phasen, der Reihe nach. Prüfungsphasen erledigen Sie immer intern; andere können an Dienstleister gehen.",
      save: "Vorlage speichern",
      saved: "Vorlage „{{name}}“ gespeichert.",
      deleteTitle: "„{{name}}“ löschen?",
      deleteBody:
        "Stellenanzeigen, die mit dieser Vorlage gestartet wurden, behalten ihre Phasen.",
      delete: "Löschen",
      deleted: "Vorlage „{{name}}“ gelöscht.",
      edit: "Bearbeiten",
      editNamed: "Vorlage {{name}} bearbeiten",
      deleteNamed: "Vorlage {{name}} löschen",
      updated: "Aktualisiert",
      search: "Name suchen",
      count: "{{count}} von {{limit}} Vorlagen",
      empty:
        "Noch keine Pipeline-Vorlagen. Legen Sie eine an, um neue Stellenanzeigen mit denselben Phasen zu starten.",
      noMatch: "Keine Vorlage passt zu dieser Suche.",
    },
  },
} satisfies LocaleResource;
