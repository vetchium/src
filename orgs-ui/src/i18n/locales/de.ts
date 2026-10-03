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
    signedInAs: "Angemeldet als",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Navigation öffnen",
    home: "Startseite",
    members: "Mitglieder",
    plans: "Tarif und Abrechnung",
    settings: "Organisationseinstellungen",
    security: "Sicherheit",
    restoreDomain: "Domain wiederherstellen",
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
    password: "Passwort",
    permissions: "Berechtigungen",
    recoveryCode: "Wiederherstellungscode",
    releaseAfter: "Freigabe nach",
    totpCode: "Sechsstelliger Code",
    workEmail: "Geschäftliche E-Mail-Adresse",
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
    workEmail:
      "Geben Sie eine E-Mail-Adresse unter der eigenen Domain Ihrer Organisation ein, etwa name@example.com.",
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
      "Mit Adressen öffentlicher E-Mail-Anbieter kann keine Organisation registriert werden. Verwenden Sie eine Adresse unter der eigenen Domain Ihrer Organisation.",
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
    userDisabledNonpayment:
      "Ihr Konto wurde deaktiviert, weil das Abonnement Ihrer Organisation nicht bezahlt wurde. Wenden Sie sich an die Administratoren Ihrer Organisation.",
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
    billingPastDue:
      "Der Tarif kann nicht geändert werden, solange eine Rechnung unbezahlt ist. Bezahlen Sie zuerst die offene Rechnung.",
    paymentMethodRequired: "Speichern Sie zuerst eine Zahlungsmethode.",
    paymentDeclined:
      "Die gespeicherte Zahlungsmethode wurde abgelehnt. Es wurde nichts geändert.",
    invoiceNotOpen: "Diese Rechnung ist nicht mehr zur Zahlung offen.",
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
      "Wählen Sie, wo die Daten Ihrer Organisation gespeichert werden. Wählen Sie das Land, in dem Ihre Organisation hauptsächlich tätig ist, um die empfohlene Region zu sehen.",
    country: "Land",
    language: "Sprache",
    regionLabel: "Region",
    recommendedRegion: "{{region}} ({{tenant}}), empfohlen",
    regionOption: "{{region}} ({{tenant}})",
    continueRegion: "Weiter in {{region}} ({{tenant}})",
    continue: "Weiter",
    noRegions:
      "Derzeit nimmt keine Region Registrierungen von Organisationen an.",
    hosting: "Ihre Organisation wird in {{region}} ({{tenant}}) gespeichert.",
    changeRegion: "Andere Region wählen",
    documentTitle: "Registrieren | Vetchium für Organisationen",
    title: "Organisation registrieren",
    description:
      "Ihre Organisation wird über ihre Domain erkannt. Um zu belegen, dass sie die Domain verwaltet, veröffentlichen Sie einen DNS-Eintrag, den wir Ihnen senden.",
    requester:
      "Das sollte die Person übernehmen, die die Domain für die Organisation verwaltet, meist die IT. Wer die Registrierung abschließt, wird der erste Superadmin der Organisation.",
    emailHelp:
      "Verwenden Sie Ihre Adresse unter der Domain, mit der sich die Organisation registriert.",
    derivedDomain: "Zu registrierende Domain: {{domain}}",
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
      again: "Andere E-Mail-Adresse verwenden",
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
    action: "Domain verifizieren und Organisation anlegen",
    pending:
      "Die Domain ist verifiziert und die Organisation wird angelegt. Diese Seite prüft automatisch erneut.",
    stillPending:
      "Die Organisation wird noch angelegt. Prüfen Sie in einigen Minuten erneut.",
    checkAgain: "Erneut prüfen",
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
    accountCard: "Ihr Konto",
    noPermissions: "Keine Berechtigungen",
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
        "Benutzer einladen, deaktivieren und wieder aktivieren und ihre Berechtigungen ändern, außer Superadmin und Abrechnung.",
    },
    "org:manage_billing": {
      name: "MANAGE_BILLING",
      description:
        "Den Tarif der Organisation wählen, bezahlen und Rechnungen einsehen.",
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
    documentTitle: "Sicherheit | Vetchium für Organisationen",
    title: "Sicherheit",
    description: "Anmeldeeinstellungen für {{email}}.",
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
  billing: {
    banner: {
      pastDue: "Die Zahlung Ihrer Organisation ist überfällig",
      pastDueDetail:
        "Benutzer über der Grenze des Free-Tarifs können nach dem {{deadline}} deaktiviert werden, wenn die Rechnung nicht bezahlt wird.",
      ending: "Ihr Tarif wechselt am {{date}} zu {{plan}}",
      endingDetail:
        "Dann enden die Funktionen des aktuellen Tarifs. Wählen Sie den aktuellen Tarif erneut, um ihn zu behalten.",
      managePlan: "Tarif verwalten",
      noMethod: "Es ist keine Zahlungsmethode gespeichert",
      noMethodDetail:
        "Speichern Sie eine, damit die nächste Verlängerung eingezogen werden kann und Ihre Organisation im Tarif bleibt.",
      addMethod: "Zahlungsmethode hinzufügen",
    },
  },
  plans: {
    documentTitle: "Tarif und Abrechnung | Vetchium für Organisationen",
    title: "Tarif und Abrechnung",
    description:
      "Wählen Sie den Tarif Ihrer Organisation, verwalten Sie die Bezahlung und prüfen Sie die Rechnungen.",
    loadingLabel: "Tarife werden geladen",
    names: {
      "org-free-tier": "Free",
      "org-silver-tier": "Silver",
      "org-gold-tier": "Gold",
    },
    current: {
      title: "Aktueller Tarif",
      plan: "Tarif",
      state: "Abrechnung",
      renews: "Verlängerung am",
      ends: "Tarif endet am",
      scheduled: "Wechsel zu",
      seatsLabel: "Benutzer",
      seats:
        "{{used}} von {{limit}} Plätzen belegt (Benutzer und offene Einladungen)",
      seatsUnlimited: "{{used}} Plätze belegt (ohne Begrenzung)",
      pastDue: "Eine Rechnung ist überfällig",
      pastDueDetail:
        "Bezahlen Sie sie vor dem {{deadline}}, sonst werden Benutzer über der Grenze des Free-Tarifs deaktiviert.",
      payNow: "Jetzt bezahlen",
    },
    billingState: { current: "Aktuell", "past-due": "Überfällig" },
    unknownPlanTitle: "Unbekannter Tarif",
    unknownPlanDescription:
      "Diese Organisation hat den Tarif {{plan}}, den diese Version des Portals nicht kennt. Tarifänderungen sind deaktiviert, bis das Portal aktualisiert wird.",
    interval: { month: "Monatlich", year: "Jährlich" },
    pricePeriod: { month: "pro Monat", year: "pro Jahr" },
    billingIntervalLabel: "Abrechnungszeitraum",
    annualSaving: "Ein Monat gratis",
    pricingNote:
      "Preise gelten pro Organisation, nicht pro Benutzer, und enthalten Steuern.",
    introductoryPricing: "Einführungspreis",
    fossNote:
      "Kostenpflichtige Tarife finanzieren die Entwicklung von Vetchium, einem freien Open-Source-Projekt.",
    planCardLabel: "Tarif {{plan}}",
    currentBadge: "Aktuell",
    yourPlan: "Ihr Tarif",
    recommended: "Empfohlen",
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
    },
    comparison: {
      feature: "Funktion",
      users: "Benutzer",
      openings: "Stellenausschreibungen pro Jahr",
      logo: "Logo der Organisation",
      googleSignIn: "Google-Anmeldung",
      ticketSupport: "Support per Ticket",
      mcp: "MCP-Unterstützung",
    },
    actions: {
      current: "Aktueller Tarif",
      keep: "Diesen Tarif behalten",
      upgrade: "Upgrade",
      switchToAnnual: "Auf jährlich wechseln",
      switchToFree: "Zum Periodenende auf Free wechseln",
      switchAtPeriodEnd: "Zum Periodenende wechseln",
    },
    confirmTitle: "Den Tarif zum Ende des Zeitraums ändern?",
    confirmDescription:
      "Ihre Organisation behält den aktuellen Tarif bis zum {{date}} und wechselt dann zum neuen.",
    confirmDescriptionNoDate:
      "Ihre Organisation behält den aktuellen Tarif bis zum Ende des Zeitraums und wechselt dann zum neuen.",
    confirmBack: "Zurück",
    lockedPastDue:
      "Bezahlen Sie die überfällige Rechnung, bevor Sie den Tarif ändern.",
    lockedSuspended:
      "Der Tarif kann nicht geändert werden, solange die Organisation gesperrt ist.",
    payment: {
      title: "Zahlungsmethode",
      simulated:
        "Zahlungen sind simuliert: Es wird keine echte Karte verwendet und nichts abgebucht. Die gewählte Karte entscheidet, ob eine Zahlung gelingt.",
      none: "Es ist keine Zahlungsmethode gespeichert.",
      saved: "Gespeichert: {{card}}",
      choose: "Zahlungsmethode",
      save: "Zahlungsmethode speichern",
      remove: "Entfernen",
      kinds: {
        "simulated-succeeds":
          "Testkarte mit Endziffern 4242 (Zahlungen gelingen)",
        "simulated-declines":
          "Testkarte mit Endziffern 0002 (Zahlungen werden abgelehnt)",
      },
    },
    invoices: {
      title: "Rechnungen",
      period: "Zeitraum",
      plan: "Tarif",
      reason: "Grund",
      state: "Status",
      actions: "Aktionen",
      empty: "Noch keine Rechnungen.",
      reasons: { upgrade: "Upgrade", renewal: "Verlängerung" },
      states: { paid: "Bezahlt", open: "Offen", void: "Storniert" },
    },
  },
  settings: {
    documentTitle: "Organisationseinstellungen | Vetchium für Organisationen",
    title: "Organisationseinstellungen",
    description: "Einstellungen, die nur ein Superadmin ändern kann.",
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
    member: "Mitglied",
    custom: "Benutzerdefiniert",
  },
  users: {
    documentTitle: "Mitglieder | Vetchium für Organisationen",
    title: "Mitglieder",
    description:
      "Laden Sie Personen ein, legen Sie fest, was sie tun dürfen, und schalten Sie Konten ab, wenn sie gehen.",
    tabs: { members: "Mitglieder", invitations: "Einladungen" },
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
      disabledNonpayment: "Deaktiviert, Abonnement nicht bezahlt",
    },
    filters: { state: "Status", role: "Rolle" },
    filterState: {
      active: "Aktiv",
      "disabled-manual": "Deaktiviert",
      "disabled-nonpayment": "Deaktiviert, Abonnement nicht bezahlt",
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
        "disabled-nonpayment": "{{count}} unbezahlt",
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
} as const satisfies LocaleResource;
