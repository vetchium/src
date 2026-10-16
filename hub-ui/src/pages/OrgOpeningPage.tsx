import { OpeningContentView } from "@vetchium/portal-ui/openings";
import { Button, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import {
  OpeningNotFoundError,
  OrgNotFoundError,
  OrgUnavailableError,
} from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { openingContentPresentation } from "../features/openings/presentation";
import { useOrgOpeningQuery } from "../features/openings/queries";
import { OrgHeader } from "./OrgPage";

export function OrgOpeningPage() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const domain = normalizeOrgDomain(params.domain ?? "");
  const number = Number(params.number);
  const valid =
    isOrgDomain(domain) &&
    Number.isInteger(number) &&
    number > 0 &&
    number <= 2_147_483_647;
  const result = useOrgOpeningQuery(domain, number, valid);
  const presentation = openingContentPresentation(t, i18n.language);
  return (
    <>
      <NoIndex />
      <title>{t("orgPage.openingDocumentTitle")}</title>
      {!valid ||
      (result.isError &&
        (isProblem(result.error, OpeningNotFoundError.type) ||
          isProblem(result.error, OrgNotFoundError.type))) ? (
        <Typography.Text>{t("orgPage.openingNotFound")}</Typography.Text>
      ) : result.isPending ? (
        <Typography.Text>{t("orgPage.loading")}</Typography.Text>
      ) : result.isError ? (
        isProblem(result.error, OrgUnavailableError.type) ? (
          <Typography.Text>{t("orgPage.unavailable")}</Typography.Text>
        ) : (
          <APIErrorAlert error={result.error} />
        )
      ) : (
        <Space orientation="vertical" size="large" style={{ width: "100%" }}>
          <OrgHeader org={result.data.org} />
          <Link to={`/org/${encodeURIComponent(domain)}`}>
            <Button>{t("orgPage.backToOpenings")}</Button>
          </Link>
          {result.data.opening.state === "published" ? (
            <OpeningContentView
              content={result.data.opening.content}
              {...presentation}
            />
          ) : (
            <>
              <Typography.Title level={2}>
                {result.data.opening.title}
              </Typography.Title>
              <Typography.Text>{t("orgPage.notAccepting")}</Typography.Text>
            </>
          )}
        </Space>
      )}
    </>
  );
}
