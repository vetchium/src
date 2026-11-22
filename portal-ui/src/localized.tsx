import type { TFunction } from "i18next";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

/** A translation key, or a translation that needs values. */
type Message = string | ((t: TFunction) => string);

function LocalizedMessage({ message }: { message: Message }) {
  const { t } = useTranslation();
  return typeof message === "string" ? t(message) : message(t);
}

/**
 * A message to keep, such as a Form error or an error in state. It is
 * translated where it shows, so it follows a language switch; `t()` would
 * keep the language it was called in. Pass a function for values and
 * translate everything inside it.
 */
export function localized(message: Message): ReactElement {
  return <LocalizedMessage message={message} />;
}

/**
 * A localized error for `form.setFields`. Ant Design types field errors as
 * strings but keeps and shows any node, as it does for rule messages.
 */
export function fieldErrors(error: ReactElement): string[] {
  return [error] as unknown as string[];
}
