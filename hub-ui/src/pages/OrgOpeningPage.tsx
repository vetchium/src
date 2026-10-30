import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import { OpeningView } from "@vetchium/portal-ui/openings";
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Flex,
  Skeleton,
  Typography,
} from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { FrontendLocale } from "typespec/hub/types";
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
import { openingPresentation } from "../features/openings/presentation";
import { useOrgOpeningQuery } from "../features/openings/queries";
import { countryName } from "../i18n/countries";
import { applicationPath } from "./ApplicationsPage";

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
  const presentation = openingPresentation(t, i18n.language);
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
  const orgPath = `/org/${encodeURIComponent(domain)}`;
  const applyPath = `${orgPath}/openings/${number}/apply`;

  if (
    !valid ||
    (result.isError &&
      (isProblem(result.error, OpeningNotFoundError.type) ||
        isProblem(result.error, OrgNotFoundError.type)))
  )
    return <Typography.Text>{t("orgPage.openingNotFound")}</Typography.Text>;
  if (result.isPending)
    return <Typography.Text>{t("orgPage.loading")}</Typography.Text>;
  if (result.isError)
    return isProblem(result.error, OrgUnavailableError.type) ? (
      <Typography.Text>{t("orgPage.unavailable")}</Typography.Text>
    ) : (
      <APIErrorAlert error={result.error} />
    );

  const { org, opening } = result.data;
  const title =
    opening.state === "published"
      ? (opening.content.title ?? "")
      : opening.title;
  const appliedNotice = applied !== undefined && (
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
  );

  return (
    <Flex vertical gap="large">
      <NoIndex />
      <title>{t("orgPage.openingDocumentTitle")}</title>
      <Breadcrumb
        items={[
          { title: <Link to={orgPath}>{org.display_name}</Link> },
          { title },
        ]}
      />
      {opening.state !== "published" ? (
        <Card>
          <Flex vertical gap="middle">
            <Typography.Title level={1}>{title}</Typography.Title>
            {appliedNotice}
            <Alert type="info" showIcon title={t("orgPage.notAccepting")} />
          </Flex>
        </Card>
      ) : (
        <OpeningView
          content={opening.content}
          presentation={presentation}
          org={{
            name: <Link to={orgPath}>{org.display_name}</Link>,
            detail: [
              org.domain,
              t("orgPage.basedIn", {
                country: countryName(
                  org.country,
                  i18n.language as FrontendLocale,
                ),
              }),
            ].join(" · "),
            ...(org.logo_url && { logoURL: org.logo_url }),
          }}
          aside={
            <Card>
              <Flex vertical gap="middle">
                {applied !== undefined ? (
                  appliedNotice
                ) : applications.isPending ? (
                  <Skeleton.Button
                    active
                    block
                    aria-label={t("orgPage.loading")}
                  />
                ) : (
                  <Link
                    to={
                      suggestion && opening.accepts_agency_referrals
                        ? `${applyPath}?referred_by=${encodeURIComponent(suggestion.agency_domain)}`
                        : applyPath
                    }
                  >
                    <Button type="primary" size="large" block>
                      {t("orgPage.apply")}
                    </Button>
                  </Link>
                )}
                {applied === undefined && (
                  <Typography.Text type="secondary">
                    {opening.content.questions?.length
                      ? t("orgPage.applyHelpQuestions", {
                          count: opening.content.questions.length,
                        })
                      : t("orgPage.applyHelp")}
                  </Typography.Text>
                )}
                {suggestion !== null && applied === undefined && (
                  <Alert
                    type="info"
                    showIcon
                    title={t("orgPage.agencySuggestedTitle", {
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
                        .
                        {opening.accepts_agency_referrals &&
                          ` ${t("orgPage.agencySuggestedCredit")}`}
                      </span>
                    }
                  />
                )}
                <Typography.Text type="secondary">
                  {opening.last_revised_at
                    ? t("orgPage.postedAndUpdated", {
                        posted: date(opening.first_published_at, "medium"),
                        updated: date(opening.last_revised_at, "medium"),
                      })
                    : t("orgPage.posted", {
                        date: date(opening.first_published_at, "medium"),
                      })}
                </Typography.Text>
              </Flex>
            </Card>
          }
        />
      )}
    </Flex>
  );
}
