import { OpeningTagFilter } from "@vetchium/portal-ui/opening-tags";
import {
  Avatar,
  Button,
  Empty,
  Flex,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";
import type {
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "typespec/common/openings";
import {
  type ListOrgOpeningsRequest,
  type PublicOrg,
  validateListOrgOpeningsRequest,
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
import { OpeningCard } from "../features/openings/OpeningCard";
import {
  useOpeningTags,
  useOrgOpeningsQuery,
} from "../features/openings/queries";
import { countryName, countryOptions } from "../i18n/countries";

export function OrgHeader({ org }: { org: PublicOrg }) {
  const { t, i18n } = useTranslation();
  return (
    <Space align="center">
      {org.logo_url && (
        <Avatar size={64} shape="square" src={org.logo_url} alt="" />
      )}
      <div>
        <Typography.Title level={1}>{org.display_name}</Typography.Title>
        <Typography.Text type="secondary">
          {[
            org.domain,
            t("orgPage.basedIn", {
              country: countryName(
                org.country,
                i18n.language as FrontendLocale,
              ),
            }),
          ].join(" · ")}
        </Typography.Text>
      </div>
    </Space>
  );
}

// Filters are kept in the URL so reload, back, and shared links keep them.
const filterParams = {
  employing_country: "country",
  work_arrangement: "arrangement",
  employment_type: "employment",
  tag_oid: "tag",
  title_query: "title",
} as const;

type OrgOpeningsFilters = Pick<
  ListOrgOpeningsRequest,
  keyof typeof filterParams
>;

// A hand-edited value the API would refuse is dropped instead of sent.
function filtersFromSearch(
  domain: string,
  search: URLSearchParams,
): OrgOpeningsFilters {
  const filters: Record<string, string> = {};
  for (const [field, param] of Object.entries(filterParams)) {
    const value = search.get(param);
    if (value) filters[field] = value;
  }
  const invalid = validateListOrgOpeningsRequest({
    domain,
    ...(filters as OrgOpeningsFilters),
  });
  for (const field of invalid) delete filters[field];
  return filters as OrgOpeningsFilters;
}

export function OrgPage() {
  const domain = normalizeOrgDomain(useParams().domain ?? "");
  // The route keeps this page mounted across Orgs; a new Org starts with its
  // own title input and first page, not the previous Org's pagination keys.
  return <OrgPageContent key={domain} domain={domain} />;
}

function OrgPageContent({ domain }: { domain: string }) {
  const { t, i18n } = useTranslation();
  const validDomain = isOrgDomain(domain);
  const [search, setSearch] = useSearchParams();
  const filters = filtersFromSearch(domain, search);
  const [title, setTitle] = useState(filters.title_query ?? "");
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const pageKey = pages[pages.length - 1];
  const changeFilter = (
    field: keyof OrgOpeningsFilters,
    value: string | undefined,
  ) => {
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === undefined) next.delete(filterParams[field]);
        else next.set(filterParams[field], value);
        return next;
      },
      { replace: true },
    );
    setPages([undefined]);
  };
  const request: ListOrgOpeningsRequest = {
    domain,
    ...filters,
    ...(pageKey && { pagination_key: pageKey }),
    limit: 20,
  };
  const result = useOrgOpeningsQuery(request, validDomain);
  const tags = useOpeningTags();
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
              showSearch={{ optionFilterProp: "label" }}
              placeholder={t("orgPage.fields.country")}
              options={countries}
              value={filters.employing_country}
              onChange={(value?: string) =>
                changeFilter("employing_country", value)
              }
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
              value={filters.work_arrangement}
              onChange={(value?: OpeningWorkArrangement) =>
                changeFilter("work_arrangement", value)
              }
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
              value={filters.employment_type}
              onChange={(value?: OpeningEmploymentType) =>
                changeFilter("employment_type", value)
              }
              style={{ minWidth: 150 }}
            />
            <OpeningTagFilter
              label={t("orgPage.fields.tag")}
              placeholder={t("orgPage.fields.tag")}
              value={filters.tag_oid}
              onChange={(value) => changeFilter("tag_oid", value)}
              locale={i18n.language}
              catalog={tags.catalog}
              unavailable={
                tags.failed ? t("orgPage.tagsUnavailable") : undefined
              }
              style={{ minWidth: 180 }}
            />
            <Input.Search
              aria-label={t("orgPage.titleSearch")}
              enterButton={t("orgPage.search")}
              placeholder={t("orgPage.titleSearch")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onSearch={(value) =>
                changeFilter(
                  "title_query",
                  [...value.trim()].length >= 2 ? value.trim() : undefined,
                )
              }
              style={{ width: 240 }}
            />
          </Space>
          {result.data.openings.length === 0 ? (
            <Empty description={t("orgPage.empty")} />
          ) : (
            <Flex vertical gap="middle">
              {result.data.openings.map((opening) => (
                <OpeningCard
                  key={opening.opening_number}
                  opening={opening}
                  domain={domain}
                />
              ))}
            </Flex>
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
