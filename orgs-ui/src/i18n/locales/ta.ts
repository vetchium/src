import type { LocaleResource } from "./en";

export const ta = {
  shell: {
    documentTitle: "நிறுவனங்களுக்கான Vetchium",
    brand: "Vetchium",
    monogram: "V",
    homeLabel: "நிறுவனங்களுக்கான Vetchium முகப்பு",
    footer: "நிறுவனங்களுக்கான Vetchium",
  },
  theme: {
    toggleLabel: "ஒளி அல்லது இருள் பயன்முறைக்கு மாற்று",
  },
  language: {
    selectorLabel: "மொழியைத் தேர்ந்தெடுக்கவும்",
    changeError: "மொழியை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
  },
  home: {
    title: "நிறுவனங்களுக்கான Vetchium",
    description: "Vetchium-இல் உங்கள் நிறுவனத்தின் முகப்பு.",
  },
  notFound: {
    title: "பக்கம் கிடைக்கவில்லை",
    description: "நீங்கள் கோரிய பக்கம் இல்லை.",
    action: "முகப்புக்குச் செல்",
  },
} as const satisfies LocaleResource;
