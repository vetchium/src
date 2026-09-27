import { Superadmin } from "typespec/orgs/authorization/types";
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
      "Domain, E-Mail-Adresse oder Passwort wurden nicht akzeptiert.",
    userDisabled:
      "Dieses Konto ist deaktiviert. Wenden Sie sich an einen Superadmin Ihrer Organisation.",
    incorrectPassword: "Das Passwort wurde nicht akzeptiert.",
    expiredLoginChallenge:
      "Diese Anmeldung ist abgelaufen. Beginnen Sie erneut.",
    incorrectTOTP: "Der Code wurde nicht akzeptiert.",
    incorrectRecoveryCode: "Der Wiederherstellungscode wurde nicht akzeptiert.",
    invalidResetToken:
      "Dieser Link zum Zurücksetzen des Passworts ist ungültig, abgelaufen oder wurde bereits verwendet.",
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
    retryRegions: "Erneut versuchen",
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
  login: {
    documentTitle: "Anmelden | Vetchium für Organisationen",
    title: "Anmelden",
    description: "Melden Sie sich beim Konto Ihrer Organisation an.",
    domainHelp: "Die Domain Ihrer Organisation, etwa example.com.",
    action: "Anmelden",
    forgotPassword: "Passwort vergessen?",
    noAccount: "Ist Ihre Organisation noch nicht auf Vetchium?",
    signUp: "Jetzt registrieren",
    homedElsewhere: {
      title: "{{domain}} meldet sich in einer anderen Region an",
      description:
        "Das Konto Ihrer Organisation wird in einer anderen Vetchium-Region geführt. Melden Sie sich dort an.",
      action: "Weiter zu dieser Region",
    },
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
    [Superadmin]: "SUPERADMIN",
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
  notFound: {
    title: "Seite nicht gefunden",
    description: "Die angeforderte Seite existiert nicht.",
    action: "Zur Startseite",
  },
} as const satisfies LocaleResource;
