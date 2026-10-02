import { Button, Result } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { NoIndex } from "../components/common/NoIndex";

/** Reserves `/org/<domain>` until Org information pages exist. */
export function OrgPage() {
  const { t } = useTranslation();
  const domain = useParams().domain ?? "";
  return (
    <>
      <NoIndex />
      <title>{t("orgPage.documentTitle")}</title>
      <Result
        status="info"
        title={t("orgPage.title")}
        subTitle={t("orgPage.description", { domain })}
        extra={
          <Link to="/">
            <Button type="primary">{t("orgPage.action")}</Button>
          </Link>
        }
      />
    </>
  );
}
