import {
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type {
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "typespec/common/openings";
import type {
  ListOrgOpeningsRequest,
  PublicOrg,
} from "typespec/hub/openings/public";
import type { FrontendLocale } from "typespec/hub/types";
import { isOrgDomain, normalizeOrgDomain } from "typespec/orgs/types";
import {
  OrgNotFoundError,
  OrgUnavailableError,
} from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { useOrgOpeningsQuery } from "../features/openings/queries";
import { countryOptions } from "../i18n/countries";

export function OrgHeader({ org }: { org: PublicOrg }) {
  return (
    <Space align="center">
      {org.logo_url && (
        <Avatar size={64} shape="square" src={org.logo_url} alt="" />
      )}
      <div>
        <Typography.Title level={1}>{org.display_name}</Typography.Title>
        <Typography.Text type="secondary">{org.domain}</Typography.Text>
      </div>
    </Space>
  );
}

export function OrgPage() {
  const { t, i18n } = useTranslation();
  const domain = normalizeOrgDomain(useParams().domain ?? "");
  const validDomain = isOrgDomain(domain);
  const [country, setCountry] = useState<string | undefined>();
  const [arrangement, setArrangement] = useState<
    OpeningWorkArrangement | undefined
  >();
  const [employment, setEmployment] = useState<
    OpeningEmploymentType | undefined
  >();
  const [title, setTitle] = useState("");
  const [queryTitle, setQueryTitle] = useState<string | undefined>();
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const pageKey = pages[pages.length - 1];
  const changeFilter = (apply: () => void) => {
    apply();
    setPages([undefined]);
  };
  const request: ListOrgOpeningsRequest = {
    domain,
    ...(country && { employing_country: country }),
    ...(arrangement && { work_arrangement: arrangement }),
    ...(employment && { employment_type: employment }),
    ...(queryTitle && { title_query: queryTitle }),
    ...(pageKey && { pagination_key: pageKey }),
    limit: 20,
  };
  const result = useOrgOpeningsQuery(request, validDomain);
  const countries = countryOptions(i18n.language as FrontendLocale);
  return (
    <>
      <NoIndex />
      <title>{t("orgPage.documentTitle")}</title>
      {!validDomain ||
      (result.isError && isProblem(result.error, OrgNotFoundError.type)) ? (
        <Typography.Text>{t("orgPage.notFound")}</Typography.Text>
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
          <Typography.Title level={2}>{t("orgPage.openings")}</Typography.Title>
          <Space wrap>
            <Select
              aria-label={t("orgPage.fields.country")}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("orgPage.fields.country")}
              options={countries}
              value={country}
              onChange={(value) => changeFilter(() => setCountry(value))}
              style={{ minWidth: 180 }}
            />
            <Select
              aria-label={t("orgPage.fields.workArrangement")}
              allowClear
              placeholder={t("orgPage.fields.workArrangement")}
              options={(["on_site", "hybrid", "remote"] as const).map(
                (value) => ({
                  value,
                  label: t(`orgPage.workArrangements.${value}`),
                }),
              )}
              value={arrangement}
              onChange={(value) => changeFilter(() => setArrangement(value))}
              style={{ minWidth: 150 }}
            />
            <Select
              aria-label={t("orgPage.fields.employmentType")}
              allowClear
              placeholder={t("orgPage.fields.employmentType")}
              options={(
                ["full_time", "part_time", "contract", "internship"] as const
              ).map((value) => ({
                value,
                label: t(`orgPage.employmentTypes.${value}`),
              }))}
              value={employment}
              onChange={(value) => changeFilter(() => setEmployment(value))}
              style={{ minWidth: 150 }}
            />
            <Input.Search
              aria-label={t("orgPage.titleSearch")}
              enterButton={t("orgPage.search")}
              placeholder={t("orgPage.titleSearch")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onSearch={(value) =>
                changeFilter(() =>
                  setQueryTitle(
                    [...value.trim()].length >= 2 ? value.trim() : undefined,
                  ),
                )
              }
              style={{ width: 240 }}
            />
          </Space>
          {result.data.openings.length === 0 ? (
            <Empty description={t("orgPage.empty")} />
          ) : (
            result.data.openings.map((opening) => (
              <Card key={opening.opening_number}>
                <Link
                  to={`/org/${encodeURIComponent(domain)}/openings/${opening.opening_number}`}
                >
                  <Typography.Title level={3}>{opening.title}</Typography.Title>
                </Link>
                <Space wrap>
                  <Typography.Text>
                    {countries.find(
                      (entry) => entry.value === opening.employing_country,
                    )?.label ?? opening.employing_country}
                  </Typography.Text>
                  <Typography.Text>
                    {t(`orgPage.workArrangements.${opening.work_arrangement}`)}
                  </Typography.Text>
                  <Typography.Text>
                    {t(`orgPage.employmentTypes.${opening.employment_type}`)}
                  </Typography.Text>
                </Space>
              </Card>
            ))
          )}
          <Space>
            {pages.length > 1 && (
              <Button onClick={() => setPages((values) => values.slice(0, -1))}>
                {t("orgPage.previous")}
              </Button>
            )}
            {result.data.next_pagination_key && (
              <Button
                onClick={() =>
                  setPages((values) => [
                    ...values,
                    result.data.next_pagination_key,
                  ])
                }
              >
                {t("orgPage.next")}
              </Button>
            )}
          </Space>
        </Space>
      )}
    </>
  );
}
