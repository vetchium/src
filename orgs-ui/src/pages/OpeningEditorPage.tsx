import { Alert, Button, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { OpeningEditor } from "../features/openings/OpeningEditor";
import { useOpeningQuery } from "../features/openings/queries";

export function OpeningEditorPage() {
  const { number: numberText } = useParams();
  const number = Number(numberText);
  const { t } = useTranslation();
  const query = useOpeningQuery(number);
  if (!Number.isInteger(number) || number <= 0)
    return <Alert type="error" title={t("openings.notFound")} />;
  if (query.isLoading)
    return <Typography.Text>{t("common.loading")}</Typography.Text>;
  // A failed refetch keeps the data it had, and the editor its unsaved input.
  if (!query.data)
    return (
      <Alert
        type="error"
        title={t("openings.notFound")}
        action={
          <Button onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  return <OpeningEditor key={number} opening={query.data} />;
}
