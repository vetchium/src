import { ShopOutlined } from "@ant-design/icons";
import { useDateTimeFormat } from "@vetchium/portal-ui/date-time";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { PaginationKey } from "typespec/common/pagination";
import {
  type Capability,
  capabilityValues as capabilities,
  isCapability,
} from "typespec/orgs/marketplace/capabilities";
import {
  type Engagement,
  type EngagementState,
  engagementStateValues as engagementStates,
  isEngagementState,
} from "typespec/orgs/marketplace/engagements";
import type { ListingSummary } from "typespec/orgs/marketplace/listings";
import { paths } from "../app/paths";
import { countryOptions } from "../features/account/countryOptions";
import { languageOptions } from "../features/marketplace/languageOptions";
import {
  capabilityColors,
  capabilityLabel,
  engagementStateColors,
  engagementStateLabel,
} from "../features/marketplace/presentation";
import {
  useConsumerEngagementsQuery,
  useSearchListingsQuery,
} from "../features/marketplace/queries";

const searchTab = "search";
const engagementsTab = "engagements";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts[parts.length - 1]?.charAt(0) ?? "";
  if (parts.length === 0) return "O";
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? "O";
  return (first + last).toUpperCase();
}

export function FindProvidersPage() {
  const { t, i18n } = useTranslation();
  const { date } = useDateTimeFormat();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentTab =
    searchParams.get("tab") === engagementsTab ? engagementsTab : searchTab;

  // Search tab state
  const capabilityParam = searchParams.get("capability");
  const capability: Capability =
    capabilityParam && isCapability(capabilityParam)
      ? capabilityParam
      : "sourcing";
  const [queryText, setQueryText] = useState(searchParams.get("q") ?? "");
  const countryFilter = searchParams.get("country") ?? undefined;
  const languageFilter = searchParams.get("language") ?? undefined;
  const [searchCursorStack, setSearchCursorStack] = useState<PaginationKey[]>(
    [],
  );
  const currentSearchKey = searchCursorStack[searchCursorStack.length - 1];

  // Engagements tab state
  const engagementStateParam = searchParams.get("state");
  const engagementState: EngagementState | "open" =
    engagementStateParam &&
    (engagementStateParam === "open" || isEngagementState(engagementStateParam))
      ? (engagementStateParam as EngagementState | "open")
      : "open";
  const engagementCapabilityParam = searchParams.get("eng_capability");
  const engagementCapability =
    engagementCapabilityParam && isCapability(engagementCapabilityParam)
      ? engagementCapabilityParam
      : undefined;
  const [engCursorStack, setEngCursorStack] = useState<PaginationKey[]>([]);
  const currentEngKey = engCursorStack[engCursorStack.length - 1];

  // Queries
  const searchResult = useSearchListingsQuery(
    {
      capability,
      ...(countryFilter && { country: countryFilter }),
      ...(languageFilter && { language: languageFilter }),
      ...(queryText.trim().length >= 2 && { query: queryText.trim() }),
      ...(currentSearchKey && { pagination_key: currentSearchKey }),
      limit: 20,
    },
    currentTab === searchTab,
  );

  const activeEngagements = useConsumerEngagementsQuery(
    { state: "active", limit: 50 },
    currentTab === searchTab,
  );

  const isProviderEngaged = (domain: string, cap: Capability) => {
    return (
      activeEngagements.data?.engagements.some(
        (e) => e.counterparty.domain === domain && e.capability === cap,
      ) ?? false
    );
  };

  const listEngagementsRequest = {
    ...(engagementState !== "open" && { state: engagementState }),
    ...(engagementCapability && { capability: engagementCapability }),
    ...(currentEngKey && { pagination_key: currentEngKey }),
    limit: 25,
  };
  const engagementsResult = useConsumerEngagementsQuery(
    listEngagementsRequest,
    currentTab === engagementsTab,
  );

  // Total active/proposed count for tab badge
  const allOpenEngagements = useConsumerEngagementsQuery({ limit: 100 });
  const openCount =
    allOpenEngagements.data?.engagements.filter(
      (e) => e.state === "active" || e.state === "proposed",
    ).length ?? 0;

  const countryNames = new Intl.DisplayNames([i18n.language], {
    type: "region",
  });
  const languageNames = new Intl.DisplayNames([i18n.language], {
    type: "language",
  });

  const formatCountry = (code: string) => countryNames.of(code) ?? code;
  const formatLanguage = (tag: string) => {
    try {
      return languageNames.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };

  const countries = countryOptions(i18n.language);
  const languages = languageOptions(i18n.language);

  const setTab = (key: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key === searchTab) next.delete("tab");
      else next.set("tab", key);
      return next;
    });
  };

  const setCapability = (cap: Capability) => {
    setSearchCursorStack([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("capability", cap);
      return next;
    });
  };

  const setCountry = (code: string | undefined) => {
    setSearchCursorStack([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!code) next.delete("country");
      else next.set("country", code);
      return next;
    });
  };

  const setLanguage = (tag: string | undefined) => {
    setSearchCursorStack([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!tag) next.delete("language");
      else next.set("language", tag);
      return next;
    });
  };

  const setEngagementFilterState = (state: string) => {
    setEngCursorStack([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (state === "open") next.delete("state");
      else next.set("state", state);
      return next;
    });
  };

  const setEngagementFilterCapability = (cap: string | undefined) => {
    setEngCursorStack([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!cap) next.delete("eng_capability");
      else next.set("eng_capability", cap);
      return next;
    });
  };

  const engagementColumns: ColumnsType<Engagement> = [
    {
      title: t("marketplace.columns.provider"),
      key: "provider",
      render: (_, r) => (
        <Flex gap="small" align="center">
          <Avatar size="small" style={{ backgroundColor: "#2563eb" }}>
            {getInitials(r.counterparty.display_name)}
          </Avatar>
          <Flex vertical>
            <Link to={paths.engagementDetail(r.id)} style={{ fontWeight: 600 }}>
              {r.counterparty.display_name}
            </Link>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.counterparty.domain}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    },
    {
      title: t("marketplace.columns.capability"),
      key: "capability",
      render: (_, r) => (
        <Tag color={capabilityColors[r.capability]}>
          {capabilityLabel(t, r.capability)}
        </Tag>
      ),
    },
    {
      title: t("marketplace.columns.state"),
      key: "state",
      render: (_, r) => (
        <Flex vertical gap={2}>
          <Tag color={engagementStateColors[r.state]}>
            {engagementStateLabel(t, r.state)}
          </Tag>
          {r.state === "proposed" && r.expires_at && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("marketplace.expiresAt", { date: date(r.expires_at) })}
            </Typography.Text>
          )}
        </Flex>
      ),
    },
    {
      title: t("marketplace.columns.yourReference"),
      key: "consumer_reference",
      render: (_, r) => r.consumer_reference || "—",
    },
    {
      title: t("marketplace.columns.theirReference"),
      key: "provider_reference",
      render: (_, r) => r.provider_reference || "—",
    },
    {
      title: t("marketplace.columns.since"),
      key: "since",
      render: (_, r) => date(r.decided_at ?? r.proposed_at),
    },
  ];

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <div>
        <Typography.Title level={1}>
          <Flex gap="small" align="center">
            <ShopOutlined />
            {t("marketplace.findProviders.title")}
          </Flex>
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("marketplace.findProviders.intro")}
        </Typography.Paragraph>
      </div>

      <Tabs
        activeKey={currentTab}
        onChange={setTab}
        items={[
          {
            key: searchTab,
            label: t("marketplace.findProviders.tabs.search"),
            children: (
              <Card>
                <Segmented<Capability>
                  value={capability}
                  onChange={setCapability}
                  options={capabilities.map((c) => ({
                    value: c,
                    label: capabilityLabel(t, c),
                  }))}
                  style={{ marginBottom: 16 }}
                />

                <Flex gap="small" wrap style={{ marginBottom: 16 }}>
                  <Input.Search
                    placeholder={t(
                      "marketplace.findProviders.searchPlaceholder",
                    )}
                    style={{ width: 280 }}
                    value={queryText}
                    onChange={(e) => setQueryText(e.target.value)}
                    onSearch={(val) => {
                      setSearchCursorStack([]);
                      setSearchParams((prev) => {
                        const next = new URLSearchParams(prev);
                        if (!val.trim()) next.delete("q");
                        else next.set("q", val.trim());
                        return next;
                      });
                    }}
                    allowClear
                  />
                  <Select
                    style={{ width: 200 }}
                    placeholder={t("marketplace.findProviders.servesCountry")}
                    value={countryFilter}
                    onChange={setCountry}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={countries}
                  />
                  <Select
                    style={{ width: 180 }}
                    placeholder={t("marketplace.findProviders.language")}
                    value={languageFilter}
                    onChange={setLanguage}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={languages}
                  />
                </Flex>

                {searchResult.data?.unavailable_tenants &&
                  searchResult.data.unavailable_tenants.length > 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 16 }}
                      title={t("marketplace.findProviders.incompleteResults", {
                        tenants:
                          searchResult.data.unavailable_tenants.join(", "),
                      })}
                      action={
                        <Button
                          size="small"
                          onClick={() => void searchResult.refetch()}
                        >
                          {t("common.retry")}
                        </Button>
                      }
                    />
                  )}

                {searchResult.isLoading ? (
                  <Card loading />
                ) : !searchResult.data ||
                  searchResult.data.listings.length === 0 ? (
                  <Empty
                    description={t("marketplace.findProviders.noListings")}
                  />
                ) : (
                  <Row gutter={[16, 16]}>
                    {searchResult.data.listings.map((item: ListingSummary) => (
                      <Col
                        xs={24}
                        md={12}
                        key={item.provider.domain + item.capability}
                      >
                        <Card
                          hoverable
                          onClick={() =>
                            navigate(
                              paths.listingDetail(
                                item.provider.domain,
                                item.capability,
                              ),
                            )
                          }
                          style={{ height: "100%" }}
                        >
                          <Flex gap="middle" align="start">
                            <Avatar
                              size={48}
                              src={item.provider.logo_url}
                              style={{
                                backgroundColor: "#2563eb",
                                flexShrink: 0,
                              }}
                            >
                              {getInitials(item.provider.display_name)}
                            </Avatar>
                            <Flex
                              vertical
                              gap={4}
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              <Flex
                                justify="space-between"
                                align="center"
                                gap="small"
                              >
                                <Typography.Text
                                  strong
                                  style={{ fontSize: 16 }}
                                >
                                  {item.provider.display_name}
                                </Typography.Text>
                                {isProviderEngaged(
                                  item.provider.domain,
                                  item.capability,
                                ) && (
                                  <Tag color="success">
                                    {t("marketplace.engaged")}
                                  </Tag>
                                )}
                              </Flex>
                              <Typography.Text
                                type="secondary"
                                style={{ fontSize: 12 }}
                              >
                                {item.provider.domain} ·{" "}
                                {t("marketplace.basedIn", {
                                  country: formatCountry(item.provider.country),
                                })}
                              </Typography.Text>
                              <Typography.Text strong style={{ marginTop: 4 }}>
                                {item.headline}
                              </Typography.Text>
                              <Descriptions
                                column={1}
                                size="small"
                                style={{ marginTop: 8 }}
                                items={[
                                  {
                                    key: "serves",
                                    label: t("marketplace.serves"),
                                    children: item.service.worldwide
                                      ? t("marketplace.worldwide")
                                      : item.service.countries
                                          .map(formatCountry)
                                          .join(", "),
                                  },
                                  {
                                    key: "languages",
                                    label: t("marketplace.languages"),
                                    children: item.languages
                                      .map(formatLanguage)
                                      .join(", "),
                                  },
                                  ...(item.indicative_price
                                    ? [
                                        {
                                          key: "price",
                                          label: t(
                                            "marketplace.indicativePrice",
                                          ),
                                          children: item.indicative_price,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </Flex>
                          </Flex>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                )}

                <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
                  <Button
                    disabled={searchCursorStack.length === 0}
                    onClick={() =>
                      setSearchCursorStack((prev) => prev.slice(0, -1))
                    }
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    disabled={!searchResult.data?.next_pagination_key}
                    onClick={() => {
                      const nextKey = searchResult.data?.next_pagination_key;
                      if (nextKey) {
                        setSearchCursorStack((prev) => [...prev, nextKey]);
                      }
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </Flex>
              </Card>
            ),
          },
          {
            key: engagementsTab,
            label: (
              <span>
                {t("marketplace.findProviders.tabs.engagements")}{" "}
                <Badge count={openCount} showZero color="blue" size="small" />
              </span>
            ),
            children: (
              <Card>
                <Flex
                  justify="space-between"
                  wrap
                  gap="small"
                  style={{ marginBottom: 16 }}
                >
                  <Segmented
                    value={engagementState}
                    onChange={setEngagementFilterState}
                    options={[
                      { value: "open", label: t("marketplace.filters.open") },
                      ...engagementStates.map((s) => ({
                        value: s,
                        label: engagementStateLabel(t, s),
                      })),
                    ]}
                  />
                  <Select
                    style={{ width: 180 }}
                    placeholder={t("marketplace.filters.capability")}
                    value={engagementCapability}
                    onChange={setEngagementFilterCapability}
                    allowClear
                    options={capabilities.map((c) => ({
                      value: c,
                      label: capabilityLabel(t, c),
                    }))}
                  />
                </Flex>

                <Table<Engagement>
                  rowKey="id"
                  loading={engagementsResult.isLoading}
                  pagination={false}
                  dataSource={
                    engagementState === "open"
                      ? engagementsResult.data?.engagements.filter(
                          (e) => e.state === "active" || e.state === "proposed",
                        )
                      : engagementsResult.data?.engagements
                  }
                  columns={engagementColumns}
                />

                <Flex justify="end" gap="small" style={{ marginTop: 16 }}>
                  <Button
                    disabled={engCursorStack.length === 0}
                    onClick={() =>
                      setEngCursorStack((prev) => prev.slice(0, -1))
                    }
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    disabled={!engagementsResult.data?.next_pagination_key}
                    onClick={() => {
                      const nextKey =
                        engagementsResult.data?.next_pagination_key;
                      if (nextKey) {
                        setEngCursorStack((prev) => [...prev, nextKey]);
                      }
                    }}
                  >
                    {t("common.next")}
                  </Button>
                </Flex>
              </Card>
            ),
          },
        ]}
      />
    </Space>
  );
}
