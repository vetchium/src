import { FilterOutlined, GlobalOutlined } from "@ant-design/icons";
import { OpeningTagSelect } from "@vetchium/portal-ui/opening-tags";
import { findRegion } from "@vetchium/portal-ui/region-selection";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import type {
  OpeningEducation,
  OpeningEmploymentType,
  OpeningWorkArrangement,
} from "typespec/common/openings";
import type { PublicOrg } from "typespec/hub/openings/public";
import {
  type OpeningSearchPostedWithinDays,
  OpeningSearchPostedWithinDaysValues,
  type SearchOpeningsRequest,
} from "typespec/hub/openings/search";
import type { FrontendLocale } from "typespec/hub/types";
import { RegionUnavailableError } from "typespec/problem/hub/openings";
import { isProblem } from "../api/client";
import { regionTable } from "../app/regions";
import { useAuth } from "../auth/AuthContext";
import { APIErrorAlert } from "../components/common/APIErrorAlert";
import { NoIndex } from "../components/common/NoIndex";
import { OpeningCard } from "../features/openings/OpeningCard";
import {
  useOpeningOrgSuggestions,
  useOpeningSearchQuery,
  useOpeningTags,
} from "../features/openings/queries";
import {
  type OpeningSearchFilters,
  paramsFromSearchState,
  searchStateFromParams,
} from "../features/openings/searchParams";
import { countryName, countryOptions } from "../i18n/countries";

const workArrangements: readonly OpeningWorkArrangement[] = [
  "on_site",
  "hybrid",
  "remote",
];
const employmentTypes: readonly OpeningEmploymentType[] = [
  "full_time",
  "part_time",
  "contract",
  "internship",
];
const educationLevels: readonly OpeningEducation[] = [
  "secondary",
  "bachelor",
  "master",
  "doctorate",
];

const isRegion = (tenantId: string) =>
  findRegion(regionTable, tenantId) !== undefined;

// Filters behind "More filters"; keyword and region stay in view.
function moreFiltersCount(filters: OpeningSearchFilters): number {
  return [
    filters.org_domain,
    filters.tag_oids,
    filters.work_countries,
    filters.work_arrangements,
    filters.employment_types,
    filters.posted_within_days,
    filters.experience_years,
    filters.education_level,
    filters.salary_disclosed,
  ].filter((value) => value !== undefined).length;
}

export function OpeningSearchPage() {
  const session = useAuth().session;
  if (session === null) return null;
  return <OpeningSearch sessionRegion={session.tenantId} />;
}

function OpeningSearch({ sessionRegion }: { sessionRegion: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as FrontendLocale;
  const [search, setSearch] = useSearchParams();
  const state = searchStateFromParams(search, isRegion);
  const region = state.region ?? sessionRegion;
  const filters = state.filters;
  // Paging restarts whenever the search changes, however the URL changed.
  const searchKey = paramsFromSearchState(state).toString();
  const [paging, setPaging] = useState({
    searchKey,
    pages: [undefined] as (string | undefined)[],
  });
  const pages = paging.searchKey === searchKey ? paging.pages : [undefined];
  const pageKey = pages[pages.length - 1];
  const setPages = (next: (string | undefined)[]) =>
    setPaging({ searchKey, pages: next });

  const [keyword, setKeyword] = useState(filters.keyword ?? "");
  const [shownKeyword, setShownKeyword] = useState(filters.keyword);
  if (shownKeyword !== filters.keyword) {
    setShownKeyword(filters.keyword);
    setKeyword(filters.keyword ?? "");
  }
  const [keywordTooShort, setKeywordTooShort] = useState(false);
  const [showMore, setShowMore] = useState(moreFiltersCount(filters) > 0);

  const change = (
    next: Partial<OpeningSearchFilters>,
    nextRegion: string = region,
  ) =>
    setSearch(
      paramsFromSearchState({
        ...(nextRegion !== sessionRegion && { region: nextRegion }),
        filters: { ...filters, ...next },
      }),
      { replace: true },
    );

  const request: SearchOpeningsRequest = {
    ...filters,
    ...(region !== sessionRegion && { region }),
    ...(pageKey !== undefined && { pagination_key: pageKey }),
  };
  const result = useOpeningSearchQuery(request);
  const tags = useOpeningTags();
  const countries = countryOptions(locale);
  const regionLabel = (tenantId: string) => {
    const known = findRegion(regionTable, tenantId);
    return t("region.option", {
      country:
        known === undefined
          ? tenantId
          : countryName(known.hostingCountry, locale),
      tenantId,
    });
  };
  const filtered = Object.keys(filters).length > 0;
  const hiddenCount = moreFiltersCount(filters);

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <NoIndex />
      <title>{t("openingSearch.documentTitle")}</title>
      <div>
        <Typography.Title level={1}>
          {t("openingSearch.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("openingSearch.description")}
        </Typography.Text>
      </div>
      <Card>
        <Flex vertical gap="middle">
          <Flex gap="small" wrap align="start">
            <Flex vertical gap="small" style={{ flex: "1 1 280px" }}>
              <Input.Search
                aria-label={t("openingSearch.keyword")}
                placeholder={t("openingSearch.keywordPlaceholder")}
                enterButton={t("openingSearch.search")}
                allowClear
                value={keyword}
                status={keywordTooShort ? "error" : undefined}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setKeywordTooShort(false);
                }}
                onSearch={(value) => {
                  const trimmed = value.trim();
                  const size = [...trimmed].length;
                  setKeywordTooShort(size === 1 || size > 200);
                  if (size === 1 || size > 200) return;
                  change({ keyword: size === 0 ? undefined : trimmed });
                }}
              />
              {keywordTooShort && (
                <Typography.Text type="danger">
                  {t("openingSearch.keywordLength")}
                </Typography.Text>
              )}
            </Flex>
            <Select
              aria-label={t("openingSearch.region")}
              prefix={<GlobalOutlined aria-hidden />}
              value={region}
              onChange={(value: string) =>
                change({ org_domain: undefined }, value)
              }
              options={regionTable.regions.map((entry) => ({
                value: entry.tenantId,
                label: regionLabel(entry.tenantId),
              }))}
              popupMatchSelectWidth={false}
              style={{ minWidth: 200 }}
            />
            <Badge count={hiddenCount} size="small">
              <Button
                icon={<FilterOutlined aria-hidden />}
                aria-expanded={showMore}
                onClick={() => setShowMore((open) => !open)}
              >
                {t("openingSearch.moreFilters")}
              </Button>
            </Badge>
          </Flex>
          {showMore && (
            <Form layout="vertical" component="div">
              <Row gutter={[16, 0]}>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.org")}
                    htmlFor="opening-search-org"
                  >
                    <OrgPicker
                      id="opening-search-org"
                      region={region === sessionRegion ? undefined : region}
                      value={filters.org_domain}
                      onChange={(value) => change({ org_domain: value })}
                      known={result.data?.openings.map((entry) => entry.org)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.tags")}
                    htmlFor="opening-search-tags"
                    extra={t("openingSearch.tagsHelp")}
                  >
                    <OpeningTagSelect
                      id="opening-search-tags"
                      value={filters.tag_oids}
                      onChange={(value) =>
                        change({
                          tag_oids: value.length > 0 ? value : undefined,
                        })
                      }
                      locale={i18n.language}
                      catalog={tags.catalog}
                      placeholder={t("openingSearch.any")}
                      unavailable={
                        tags.failed ? t("orgPage.tagsUnavailable") : undefined
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.countries")}
                    htmlFor="opening-search-countries"
                    extra={t("openingSearch.countriesHelp")}
                  >
                    <Select<string[]>
                      id="opening-search-countries"
                      mode="multiple"
                      maxCount={10}
                      allowClear
                      showSearch={{ optionFilterProp: "label" }}
                      placeholder={t("openingSearch.any")}
                      options={countries}
                      value={filters.work_countries ?? []}
                      onChange={(value) =>
                        change({
                          work_countries: value.length > 0 ? value : undefined,
                        })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("orgPage.fields.workArrangement")}
                    htmlFor="opening-search-arrangement"
                  >
                    <Select<OpeningWorkArrangement[]>
                      id="opening-search-arrangement"
                      mode="multiple"
                      allowClear
                      placeholder={t("openingSearch.any")}
                      options={workArrangements.map((value) => ({
                        value,
                        label: t(`orgPage.workArrangements.${value}`),
                      }))}
                      value={filters.work_arrangements ?? []}
                      onChange={(value) =>
                        change({
                          work_arrangements:
                            value.length > 0 ? value : undefined,
                        })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("orgPage.fields.employmentType")}
                    htmlFor="opening-search-employment"
                  >
                    <Select<OpeningEmploymentType[]>
                      id="opening-search-employment"
                      mode="multiple"
                      allowClear
                      placeholder={t("openingSearch.any")}
                      options={employmentTypes.map((value) => ({
                        value,
                        label: t(`orgPage.employmentTypes.${value}`),
                      }))}
                      value={filters.employment_types ?? []}
                      onChange={(value) =>
                        change({
                          employment_types:
                            value.length > 0 ? value : undefined,
                        })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.posted")}
                    htmlFor="opening-search-posted"
                  >
                    <Select<OpeningSearchPostedWithinDays>
                      id="opening-search-posted"
                      allowClear
                      placeholder={t("openingSearch.anyTime")}
                      options={OpeningSearchPostedWithinDaysValues.map(
                        (value) => ({
                          value,
                          label: t(`openingSearch.postedWithin.${value}`),
                        }),
                      )}
                      value={filters.posted_within_days}
                      onChange={(value?: OpeningSearchPostedWithinDays) =>
                        change({ posted_within_days: value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.experience")}
                    htmlFor="opening-search-experience"
                    extra={t("openingSearch.experienceHelp")}
                  >
                    <InputNumber<number>
                      id="opening-search-experience"
                      min={0}
                      max={50}
                      precision={0}
                      placeholder={t("openingSearch.any")}
                      value={filters.experience_years ?? null}
                      onChange={(value) =>
                        change({ experience_years: value ?? undefined })
                      }
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.education")}
                    htmlFor="opening-search-education"
                    extra={t("openingSearch.educationHelp")}
                  >
                    <Select<OpeningEducation>
                      id="opening-search-education"
                      allowClear
                      placeholder={t("openingSearch.any")}
                      options={educationLevels.map((value) => ({
                        value,
                        label: t(`orgPage.education.${value}`),
                      }))}
                      value={filters.education_level}
                      onChange={(value?: OpeningEducation) =>
                        change({ education_level: value })
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12} lg={8}>
                  <Form.Item
                    label={t("openingSearch.salary")}
                    htmlFor="opening-search-salary"
                  >
                    <Switch
                      id="opening-search-salary"
                      checked={filters.salary_disclosed === true}
                      onChange={(checked) =>
                        change({ salary_disclosed: checked || undefined })
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          )}
        </Flex>
      </Card>
      {result.isPending ? (
        <Flex gap="small" align="center" justify="center">
          <Spin />
          <Typography.Text type="secondary">
            {t("openingSearch.loading")}
          </Typography.Text>
        </Flex>
      ) : result.isError ? (
        isProblem(result.error, RegionUnavailableError.type) ? (
          <Alert
            type="warning"
            showIcon
            title={t("openingSearch.regionUnavailable", {
              region: regionLabel(region),
            })}
          />
        ) : (
          <APIErrorAlert error={result.error} />
        )
      ) : result.data.openings.length === 0 ? (
        <Empty description={t("openingSearch.empty")}>
          {filtered && (
            <Button
              onClick={() =>
                setSearch(
                  paramsFromSearchState({
                    ...(region !== sessionRegion && { region }),
                    filters: {},
                  }),
                  { replace: true },
                )
              }
            >
              {t("openingSearch.clearFilters")}
            </Button>
          )}
        </Empty>
      ) : (
        <Flex vertical gap="middle">
          {result.data.openings.map(({ org, opening }) => (
            <OpeningCard
              key={`${org.domain}/${opening.opening_number}`}
              opening={opening}
              domain={org.domain}
              org={org}
            />
          ))}
        </Flex>
      )}
      {result.isSuccess && (
        <Space>
          {pages.length > 1 && (
            <Button onClick={() => setPages(pages.slice(0, -1))}>
              {t("openingSearch.previous")}
            </Button>
          )}
          {result.data.next_pagination_key && (
            <Button
              onClick={() =>
                setPages([...pages, result.data.next_pagination_key])
              }
            >
              {t("openingSearch.next")}
            </Button>
          )}
        </Space>
      )}
    </Space>
  );
}

/**
 * One Org of the searched region, suggested as the user types. The URL keeps
 * only the domain, so a chosen Org is named from what the page has seen.
 */
function OrgPicker({
  id,
  region,
  value,
  onChange,
  known,
}: {
  id: string;
  region: string | undefined;
  value: string | undefined;
  onChange: (domain: string | undefined) => void;
  known: PublicOrg[] | undefined;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const { suggestions, settled } = useOpeningOrgSuggestions(region, typed);
  const label = (org: PublicOrg) =>
    t("openingSearch.orgOption", {
      name: org.display_name,
      domain: org.domain,
    });
  const seen = useRef(new Map<string, string>());
  for (const org of [...(known ?? []), ...(suggestions.data?.orgs ?? [])])
    seen.current.set(org.domain, label(org));
  const options = (suggestions.data?.orgs ?? []).map((org) => ({
    value: org.domain,
    label: label(org),
  }));
  if (value !== undefined && !options.some((option) => option.value === value))
    options.unshift({ value, label: seen.current.get(value) ?? value });
  const typedSize = [...typed.trim()].length;
  return (
    <Select<string>
      id={id}
      allowClear
      value={value}
      onChange={(next?: string) => {
        setTyped("");
        onChange(next || undefined);
      }}
      placeholder={t("openingSearch.orgPlaceholder")}
      options={options}
      loading={suggestions.isFetching || !settled}
      notFoundContent={
        typedSize < 2
          ? t("openingSearch.orgTypeMore")
          : suggestions.isFetching || !settled
            ? undefined
            : suggestions.isError
              ? t("openingSearch.orgsUnavailable")
              : t("openingSearch.orgNoneFound")
      }
      showSearch={{ filterOption: false, onSearch: setTyped }}
      popupMatchSelectWidth={false}
    />
  );
}
