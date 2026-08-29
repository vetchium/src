import { Alert } from "antd";
import { useTranslation } from "react-i18next";
import { getProblemType } from "./api";

export function problemTranslationKey(
  error: unknown,
  keys: Readonly<Record<string, string>>,
  fallback: string,
): string {
  const type = getProblemType(error);
  return type === undefined ? fallback : (keys[type] ?? fallback);
}

export function APIErrorAlert({
  error,
  problemKeys,
  fallbackKey,
}: {
  error: unknown;
  problemKeys: Readonly<Record<string, string>>;
  fallbackKey: string;
}) {
  const { t } = useTranslation();
  if (error === null || error === undefined) return null;
  return (
    <Alert
      type="error"
      showIcon
      title={t(problemTranslationKey(error, problemKeys, fallbackKey))}
    />
  );
}
