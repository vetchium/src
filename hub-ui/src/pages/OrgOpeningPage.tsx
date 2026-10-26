import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { OpeningContentView } from "@vetchium/portal-ui/openings";
import { Alert, Button, Skeleton, Space, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import {
  OpeningNotFoundError,
  OrgNotFoundError,
  OrgUnavailableError,
} from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { useMyApplicationsQuery } from "../features/applications/queries";
import { useConversationsQuery } from "../features/messages/queries";
import { openingContentPresentation } from "../features/openings/presentation";
import { useOrgOpeningQuery } from "../features/openings/queries";
import { applicationPath } from "./ApplicationsPage";
import { OrgHeader } from "./OrgPage";

export function OrgOpeningPage() {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const auth = useAuth();
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
  const applications = useMyApplicationsQuery(valid);
  const conversations = useConversationsQuery(auth.authenticated);

  const suggestion = useMemo(() => {
    if (!conversations.data) return null;
    for (const c of conversations.data.items) {
      const match = c.suggestions.find(
        (s) => s.consumer_domain === domain && s.opening_number === number,
      );
      if (match) {
        return {
          contact_id: c.contact_id,
          agency_display_name: c.agency_display_name,
          agency_domain: c.agency_domain,
          sent_at: match.sent_at,
        };
      }
    }
    return null;
  }, [conversations.data, domain, number]);

  const applied = applications.data?.find(
    (application) =>
      application.org_domain === domain &&
      application.opening_number === number,
  );
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
          {applied !== undefined ? (
            <Alert
              type="success"
              showIcon
              title={t("orgPage.youApplied")}
              action={
                <Link to={applicationPath(applied)}>
                  {t("orgPage.viewApplication")}
                </Link>
              }
            />
          ) : result.data.opening.state === "published" ? (
            applications.isPending ? (
              <Skeleton.Button active aria-label={t("orgPage.loading")} />
            ) : (
              <Link
                to={
                  suggestion
                    ? `/org/${encodeURIComponent(domain)}/openings/${number}/apply?referred_by=${encodeURIComponent(suggestion.agency_domain)}`
                    : `/org/${encodeURIComponent(domain)}/openings/${number}/apply`
                }
              >
                <Button type="primary">{t("orgPage.apply")}</Button>
              </Link>
            )
          ) : null}
          {suggestion !== null && applied === undefined && (
            <Alert
              type="info"
              showIcon
              message={t("orgPage.agencySuggestedTitle", {
                agency: suggestion.agency_display_name,
              })}
              description={
                <span>
                  {t("orgPage.agencySuggestedBody", {
                    date: date(suggestion.sent_at, "medium"),
                  })}{" "}
                  <Link
                    to={`/messages/${encodeURIComponent(suggestion.contact_id)}`}
                  >
                    {t("orgPage.yourConversation")}
                  </Link>
                  . {t("orgPage.agencySuggestedCredit")}
                </span>
              }
            />
          )}
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
