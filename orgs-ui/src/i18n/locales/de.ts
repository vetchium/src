import type { LocaleResource } from "./en";

export const de = {
  shell: {
    documentTitle: "Vetchium für Organisationen",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "Startseite von Vetchium für Organisationen",
    footer: "Vetchium für Organisationen",
  },
  theme: {
    toggleLabel: "Zwischen hellem und dunklem Modus wechseln",
  },
  language: {
    selectorLabel: "Sprache auswählen",
    changeError:
      "Die Sprache konnte nicht geändert werden. Bitte erneut versuchen.",
  },
  home: {
    title: "Vetchium für Organisationen",
    description: "Die Startseite Ihrer Organisation auf Vetchium.",
  },
  notFound: {
    title: "Seite nicht gefunden",
    description: "Die angeforderte Seite existiert nicht.",
    action: "Zur Startseite",
  },
} as const satisfies LocaleResource;
