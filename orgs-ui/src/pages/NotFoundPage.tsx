import { Button, Result } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <Result
      status="404"
      title={t("notFound.title")}
      subTitle={t("notFound.description")}
      extra={
        <Link to="/">
          <Button type="primary">{t("notFound.action")}</Button>
        </Link>
      }
    />
  );
}
