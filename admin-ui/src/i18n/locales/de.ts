export const de = {
  shell: {
    documentTitle: "Vetchium-Administration",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Startseite der Vetchium-Administration",
    portal: "Administration",
    footer: "Administration der Vetchium-Instanz",
    logout: "Abmelden",
    operationInProgress:
      "Schließen Sie den laufenden Vorgang ab, bevor Sie diese Seite verlassen.",
  },
  navigation: {
    menu: "Navigation",
    openMenu: "Navigation öffnen",
    overview: "Übersicht",
    users: "Administratoren",
    profile: "Mein Profil",
    security: "Sicherheit",
  },
  theme: {
    dark: "Dunkel",
    light: "Hell",
    toggleLabel: "Zwischen hellem und dunklem Modus wechseln",
  },
  language: {
    changeError:
      "Die Sprache konnte nicht geändert werden. Bitte erneut versuchen.",
    selectorLabel: "Sprache auswählen",
  },
  languageShort: {
    "en-US": "EN",
    ta: "TA",
    de_DE: "DE",
  },
  common: {
    all: "Alle",
    backToLogin: "Zurück zur Anmeldung",
    cancel: "Abbrechen",
    close: "Schließen",
    confirm: "Bestätigen",
    disabled: "Deaktiviert",
    enabled: "Aktiviert",
    idempotencyConflict:
      "Diese Aktion wurde bereits mit anderen Angaben gesendet. Laden Sie die Seite neu und versuchen Sie es erneut.",
    loadError: "Diese Informationen konnten nicht geladen werden.",
    next: "Weiter",
    never: "Nie",
    notEnabled: "Nicht eingerichtet",
    previous: "Zurück",
    remove: "Entfernen",
    requestError:
      "Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    retry: "Erneut versuchen",
    search: "Suchen",
    save: "Änderungen speichern",
  },
  fields: {
    administrator: "Administrator",
    access: "Zugriff",
    accountType: "Kontotyp",
    actions: "Aktionen",
    confirmPassword: "Passwort bestätigen",
    displayName: "Anzeigename",
    email: "E-Mail-Adresse",
    language: "Sprache",
    languageCode: "Sprachcode",
    lastLogin: "Letzte Anmeldung",
    name: "Name",
    newPassword: "Neues Passwort",
    password: "Passwort",
    granted: "Erteilt",
    permission: "Berechtigung",
    recoveryCode: "Wiederherstellungscode",
    recoveryCodes: "Verbleibende Wiederherstellungscodes",
    sessionExpires: "Sitzung läuft ab",
    state: "Status",
    tenant: "Instanz",
    totpCode: "Sechsstelliger Code",
    twoFactor: "Zwei-Faktor-Authentifizierung",
  },
  validation: {
    displayName: "Verwenden Sie einen Anzeigenamen mit 1 bis 200 Zeichen.",
    email: "Geben Sie eine gültige E-Mail-Adresse ein.",
    languageCode: "Verwenden Sie einen regionalen Sprachcode wie de-DE.",
    newPassword:
      "Verwenden Sie 15 bis 128 Zeichen und vermeiden Sie häufig verwendete Passwortphrasen.",
    passwordMatch: "Die Passwörter stimmen nicht überein.",
    recoveryCode: "Geben Sie einen gültigen Wiederherstellungscode ein.",
    required: "Dieses Feld ist erforderlich.",
    totpCode: "Geben Sie den sechsstelligen Code ein.",
  },
  languages: {
    "en-US": "English US",
    ta: "தமிழ்",
    de_DE: "Deutsch",
  },
  states: { active: "Aktiv", disabled: "Deaktiviert" },
  permissions: {
    "admin:view_users": {
      name: "Administratoren anzeigen",
      description:
        "Administratorkonten, deren Zugriff und Sicherheitsstatus prüfen.",
    },
    "admin:manage_users": {
      name: "Administratoren verwalten",
      description:
        "Administratoren einladen, aktivieren oder deaktivieren und deren Rechte ändern.",
    },
    unknown: {
      description:
        "Diese Berechtigung kam nach diesem Portal hinzu. Sie bleibt erhalten, solange Sie sie nicht abschalten.",
    },
    includedBy: "Enthalten in {{permission}}",
  },
  login: {
    documentTitle: "Anmelden | Vetchium-Administration",
    title: "Anmelden",
    description: "Verwenden Sie Ihr Administratorkonto für diese Instanz.",
    action: "Anmelden",
    error: "Die E-Mail-Adresse oder das Passwort wurde nicht akzeptiert.",
    forgotPassword: "Passwort vergessen?",
  },
  twoFactor: {
    documentTitle: "Zwei-Faktor-Prüfung | Vetchium-Administration",
    title: "Identität bestätigen",
    description:
      "Geben Sie einen Code aus Ihrer Authenticator-App oder einen Wiederherstellungscode ein.",
    authenticator: "Authenticator",
    recovery: "Wiederherstellungscode",
    action: "Bestätigen",
    error: "Der Code wurde nicht akzeptiert oder die Anmeldung ist abgelaufen.",
    restart: "Anmeldung neu starten",
  },
  forgotPassword: {
    documentTitle: "Passwort zurücksetzen | Vetchium-Administration",
    title: "Passwort vergessen?",
    description:
      "Geben Sie Ihre E-Mail-Adresse ein. Falls das Konto berechtigt ist, senden wir Anweisungen zum Zurücksetzen.",
    action: "Anweisungen senden",
    success:
      "Falls das Konto berechtigt ist, wurden Anweisungen zum Zurücksetzen gesendet.",
  },
  resetPassword: {
    documentTitle: "Neues Passwort wählen | Vetchium-Administration",
    title: "Neues Passwort wählen",
    missingToken:
      "Dieser Link zum Zurücksetzen des Passworts ist unvollständig.",
    success: "Ihr Passwort wurde geändert. Sie können sich jetzt anmelden.",
    error: "Dieser Link ist ungültig oder abgelaufen.",
    action: "Passwort ändern",
  },
  completeSetup: {
    documentTitle: "Kontoeinrichtung abschließen | Vetchium-Administration",
    title: "Kontoeinrichtung abschließen",
    description:
      "Vervollständigen Sie Ihr Profil und erstellen Sie ein sicheres Passwort.",
    missingToken: "Dieser Einladungslink ist unvollständig.",
    success: "Ihr Administratorkonto ist bereit.",
    error:
      "Diese Einladung ist ungültig, abgelaufen oder wurde bereits verwendet.",
    action: "Konto erstellen",
    signIn: "Weiter zur Anmeldung",
  },
  home: {
    title: "Willkommen, {{name}}",
    description: "Ihr Administratorkonto und die aktuelle Instanzsitzung.",
    accountCard: "Kontoübersicht",
    noPermissions: "Keine administrativen Berechtigungen",
  },
  users: {
    title: "Administratoren",
    description:
      "Verwalten Sie den administrativen Zugriff und prüfen Sie die Kontosicherheit.",
    searchPlaceholder: "Nach Name oder E-Mail-Adresse suchen",
    statusFilter: "Kontostatus",
    needsAttention: "Aufmerksamkeit erforderlich",
    clearFilters: "Filter zurücksetzen",
    actionsFor: "Aktionen für {{name}}",
    page: "Seite {{page}}",
    filters: {
      permissions: "Berechtigungen",
      activity: "Anmeldeaktivität",
    },
    quickFilters: {
      noTwoFactor: "Keine Zwei-Faktor-Authentifizierung",
      neverSignedIn: "Nie angemeldet",
      dormant: "Seit 90 Tagen inaktiv",
      noAccess: "Kein zugewiesener Zugriff",
    },
    activity: {
      never: "Nie angemeldet",
      inactive30: "Seit 30 Tagen inaktiv",
      inactive90: "Seit 90 Tagen inaktiv",
    },
    empty: {
      default: "Es wurden noch keine Administratoren hinzugefügt.",
      filtered: "Keine Administratoren entsprechen diesen Filtern.",
    },
    invite: {
      action: "Administrator einladen",
      title: "Administrator einladen",
      permissions: "Anfängliche Berechtigungen",
      permissionsHint:
        "Der eingeladene Administrator startet mit den hier erteilten Berechtigungen.",
      sent: "Einladung an {{email}} gesendet. Sie läuft am {{expiresAt}} ab.",
      errors: {
        alreadyExists:
          "Ein Administrator verwendet diese E-Mail-Adresse bereits.",
        alreadyPending:
          "Für diese E-Mail-Adresse ist bereits eine Einladung offen.",
      },
    },
    disable: {
      action: "Deaktivieren",
      confirm: "Diesen Administrator deaktivieren?",
      effect:
        "Die Person wird sofort abgemeldet und kann sich bis zur Aktivierung nicht erneut anmelden.",
      done: "Der Administrator ist jetzt deaktiviert.",
    },
    enable: {
      action: "Aktivieren",
      confirm: "Diesen Administrator aktivieren?",
      effect:
        "Die Person kann sich mit ihrem vorhandenen Zugriff wieder anmelden.",
      done: "Der Administrator ist jetzt aktiv.",
    },
    access: {
      action: "Zugriff verwalten",
      title: "Zugriff verwalten",
      none: "Kein zugewiesener Zugriff",
      choosePermissions: "Berechtigungen auswählen",
      choosePermissionsHint:
        "Änderungen gelten ab der nächsten Anfrage des Administrators. Eine Berechtigung, die eine andere bereits enthält, kann nicht einzeln abgeschaltet werden.",
      saved: "Administratorzugriff aktualisiert.",
      selfWarning: "Sie ändern Ihren eigenen Zugriff",
      selfWarningDetail:
        "Wenn Sie sich selbst eine Berechtigung entziehen, gilt das sofort und ein anderer Administrator muss sie wieder erteilen.",
    },
    errors: {
      notFound: "Dieser Administrator existiert nicht mehr.",
      cannotDisableSelf: "Sie können Ihr eigenes Konto nicht deaktivieren.",
      lastManager:
        "Mindestens ein aktiver Administrator muss die Berechtigung zum Verwalten von Administratoren behalten.",
    },
  },
  profile: {
    title: "Mein Profil",
    description:
      "Verwalten Sie die Anzeige Ihres Namens im Administrationsportal.",
    namesCard: "Anzeigenamen",
    primaryLanguage: "Primäre Sprache des Anzeigenamens",
    languageCodePlaceholder: "de-DE",
    addName: "Weitere Sprache hinzufügen",
    saved: "Profil aktualisiert.",
    saveError:
      "Ihr Profil konnte nicht aktualisiert werden. Prüfen Sie die Werte und versuchen Sie es erneut.",
  },
  reauthentication: {
    title: "Zum Fortfahren erneut anmelden",
    description:
      "Diese Aktion erfordert eine Anmeldung aus den letzten fünf Minuten. Melden Sie sich erneut an und versuchen Sie es noch einmal.",
    action: "Erneut anmelden",
    documentTitle: "Zugriff bestätigen | Vetchium Admin",
    pageTitle: "Zugriff bestätigen",
    pageDescription:
      "Geben Sie Ihr Passwort erneut ein, um zu dieser vertraulichen Seite zu gelangen. Ihre aktuelle Sitzung bleibt aktiv, wenn Sie abbrechen.",
    account: "Angemeldet als {{email}}",
    confirm: "Zugriff bestätigen",
    cancel: "Abbrechen",
    error: "Das Passwort wurde nicht akzeptiert. Versuchen Sie es erneut.",
  },
  security: {
    title: "Sicherheit",
    description:
      "Verwalten Sie Ihr Passwort und die Zwei-Faktor-Authentifizierung für diese Instanz.",
    password: {
      card: "Passwort",
      description:
        "Beim Ändern des Passworts werden alle anderen Sitzungen dieses Kontos abgemeldet.",
      action: "Passwort ändern",
      changed: "Ihr Passwort wurde geändert.",
    },
    twoFactor: {
      card: "Zwei-Faktor-Authentifizierung",
      description:
        "Eine Authenticator-App erzeugt einen sechsstelligen Code, der bei jeder Anmeldung erforderlich ist.",
      start: "Authenticator einrichten",
      scan: "Scannen Sie diesen Code mit Ihrer Authenticator-App.",
      qrLabel: "Code zur Authenticator-Einrichtung",
      manualKey: "Schlüssel zur manuellen Eingabe",
      algorithm: "Algorithmus",
      digits: "Stellen",
      period: "Codeintervall",
      seconds: "{{seconds}} Sekunden",
      enrollmentExpires: "Einrichtung läuft ab",
      confirm: "Bestätigen und aktivieren",
      disable: "Zwei-Faktor-Authentifizierung deaktivieren",
      disableConfirm: "Zwei-Faktor-Authentifizierung deaktivieren?",
      disableWarning:
        "Ihr Konto ist dann nur durch das Passwort geschützt, und alle anderen Sitzungen werden abgemeldet.",
      enabled: "Die Zwei-Faktor-Authentifizierung ist jetzt aktiviert.",
      disabled: "Die Zwei-Faktor-Authentifizierung ist jetzt deaktiviert.",
      errors: {
        alreadyEnabled:
          "Die Zwei-Faktor-Authentifizierung ist für dieses Konto bereits aktiviert.",
        incorrectCode:
          "Dieser Code stimmte nicht. Versuchen Sie es mit dem nächsten.",
        invalidEnrollment:
          "Diese Einrichtung ist abgelaufen. Starten Sie sie erneut.",
        notEnabled:
          "Die Zwei-Faktor-Authentifizierung muss aktiviert sein, bevor Wiederherstellungscodes ausgestellt werden können.",
      },
    },
    recoveryCodes: {
      title: "Wiederherstellungscodes",
      warning: "Speichern Sie diese Codes jetzt.",
      description:
        "Jeder Code meldet Sie einmal an, falls Sie Ihren Authenticator verlieren. Sie werden nur dieses eine Mal angezeigt, und frühere Codes gelten nicht mehr.",
      copyAll: "Alle Codes kopieren",
      saved: "Ich habe diese Codes gespeichert",
      regenerate: "Wiederherstellungscodes neu erzeugen",
      regenerateConfirm:
        "Wiederherstellungscodes ersetzen? Die aktuellen Codes gelten dann nicht mehr.",
      regenerated: "Neue Wiederherstellungscodes wurden ausgestellt.",
    },
  },
  notFound: {
    title: "404",
    description: "Die angeforderte Seite ist nicht verfügbar.",
    action: "Zur Startseite",
  },
} as const;
