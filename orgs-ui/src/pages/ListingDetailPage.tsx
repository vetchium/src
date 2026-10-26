import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Form,
  Input,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Link, useNavigate, useParams } from "react-router";
import type { Capability } from "typespec/orgs/marketplace/capabilities";
import { isCapability } from "typespec/orgs/marketplace/capabilities";
import type { OrgDomain } from "typespec/orgs/types";
import { isOrgDomain } from "typespec/orgs/types";
import { paths } from "../app/paths";
import {
  capabilityColors,
  capabilityLabel,
} from "../features/marketplace/presentation";
import { marketplaceProblem } from "../features/marketplace/problems";
import {
  useConsumerEngagementsQuery,
  useListingDetailQuery,
  useProposeEngagementMutation,
  useSetEngagementReferenceMutation,
} from "../features/marketplace/queries";

export function ListingDetailPage() {
  const { t, i18n } = useTranslation();
  const { message: toast } = App.useApp();
  const navigate = useNavigate();
  const { domain, capability: rawCapability } = useParams<{
    domain: string;
    capability: string;
  }>();

  const validDomain =
    domain && isOrgDomain(domain) ? (domain as OrgDomain) : undefined;
  const validCapability =
    rawCapability && isCapability(rawCapability)
      ? (rawCapability as Capability)
      : undefined;

  const listingQuery = useListingDetailQuery(
    {
      domain: validDomain ?? ("" as OrgDomain),
      capability: validCapability ?? "sourcing",
    },
    validDomain !== undefined && validCapability !== undefined,
  );

  const engagementsQuery = useConsumerEngagementsQuery({ limit: 50 });
  const existingEngagement = engagementsQuery.data?.engagements.find(
    (e) =>
      e.counterparty.domain === validDomain &&
      e.capability === validCapability &&
      (e.state === "active" || e.state === "proposed"),
  );

  const proposeMutation = useProposeEngagementMutation();
  const setReferenceMutation = useSetEngagementReferenceMutation();
  const proposeKey = useIdempotencyKey("propose-engagement");
  const referenceKey = useIdempotencyKey("set-engagement-reference");

  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

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

  if (!validDomain || !validCapability) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.invalidListingParams")}
      />
    );
  }

  if (listingQuery.isLoading) {
    return <Card loading />;
  }

  if (listingQuery.isError || !listingQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.listingNotFound")}
        description={t("marketplace.listingNotFoundDesc")}
      />
    );
  }

  const listing = listingQuery.data;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      const created = await proposeMutation.mutateAsync({
        request: {
          provider_domain: listing.provider.domain,
          capability: listing.capability,
          ...(message.trim() && { message: message.trim() }),
        },
        key: proposeKey.current(),
      });
      proposeKey.rotate();

      if (reference.trim()) {
        try {
          await setReferenceMutation.mutateAsync({
            request: {
              engagement_id: created.id,
              version: created.version,
              reference: reference.trim(),
            },
            key: referenceKey.current(),
          });
          referenceKey.rotate();
        } catch {
          // Setting reference is optional; engagement was created.
        }
      }

      void toast.success(t("marketplace.proposeEngagement.success"));
      navigate(paths.engagementDetail(created.id));
    } catch (err) {
      const problem = marketplaceProblem(err);
      if (problem.kind === "engagement-self") {
        setError(t("marketplace.errors.engagementSelf"));
      } else if (problem.kind === "engagement-exists") {
        setError(t("marketplace.errors.engagementExists"));
      } else if (problem.kind === "listing-not-available") {
        setError(t("marketplace.errors.listingNotAvailable"));
      } else if (problem.kind === "tenant-unavailable") {
        setError(t("marketplace.errors.tenantUnavailable"));
      } else {
        setError(t("marketplace.errors.genericProposeFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space orientation="vertical" size="large" className="full-width">
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.findProviders}>
                {t("marketplace.findProviders.title")}
              </Link>
            ),
          },
          { title: listing.provider.display_name },
        ]}
      />

      <div>
        <Flex gap="middle" align="center" wrap>
          <Typography.Title level={1} style={{ marginBottom: 0 }}>
            {listing.provider.display_name}
          </Typography.Title>
          <Tag
            color={capabilityColors[listing.capability]}
            style={{ fontSize: 14 }}
          >
            {capabilityLabel(t, listing.capability)}
          </Tag>
        </Flex>
        <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
          {listing.provider.domain} ·{" "}
          {t("marketplace.basedIn", {
            country: formatCountry(listing.provider.country),
          })}
        </Typography.Paragraph>
      </div>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Card title={listing.headline}>
            <div style={{ whiteSpace: "pre-wrap", marginBottom: 24 }}>
              <ReactMarkdown>{listing.description}</ReactMarkdown>
            </div>

            <Descriptions
              column={1}
              size="small"
              items={[
                {
                  key: "serves",
                  label: t("marketplace.serves"),
                  children: listing.service.worldwide
                    ? t("marketplace.worldwide")
                    : listing.service.countries.map(formatCountry).join(", "),
                },
                {
                  key: "languages",
                  label: t("marketplace.languages"),
                  children: listing.languages.map(formatLanguage).join(", "),
                },
                ...(listing.indicative_price
                  ? [
                      {
                        key: "price",
                        label: t("marketplace.indicativePrice"),
                        children: listing.indicative_price,
                      },
                    ]
                  : []),
                ...(listing.check_types && listing.check_types.length > 0
                  ? [
                      {
                        key: "checks",
                        label: t("marketplace.checkTypes"),
                        children: (
                          <Flex gap="small" wrap>
                            {listing.check_types.map((c) => (
                              <Tag key={c}>{c}</Tag>
                            ))}
                          </Flex>
                        ),
                      },
                    ]
                  : []),
              ]}
            />

            {listing.consent_disclosure && (
              <Card
                size="small"
                title={t("marketplace.consentDisclosure")}
                style={{ marginTop: 16 }}
              >
                <Typography.Paragraph
                  type="secondary"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {listing.consent_disclosure}
                </Typography.Paragraph>
              </Card>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title={t("marketplace.proposeEngagement.title")}>
            <Typography.Paragraph type="secondary">
              {t("marketplace.proposeEngagement.intro", {
                provider: listing.provider.display_name,
              })}
            </Typography.Paragraph>

            {existingEngagement ? (
              <Alert
                type="info"
                showIcon
                message={t("marketplace.alreadyEngagedMessage")}
                description={
                  <Link to={paths.engagementDetail(existingEngagement.id)}>
                    {t("marketplace.viewEngagement")}
                  </Link>
                }
              />
            ) : (
              <Form layout="vertical" onFinish={() => void handleSubmit()}>
                {error && (
                  <Alert
                    type="error"
                    showIcon
                    message={error}
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Form.Item
                  label={t("marketplace.proposeEngagement.messageLabel")}
                  extra={t("marketplace.proposeEngagement.messageExtra")}
                >
                  <Input.TextArea
                    rows={4}
                    maxLength={2000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t(
                      "marketplace.proposeEngagement.messagePlaceholder",
                    )}
                  />
                </Form.Item>

                <Form.Item
                  label={t("marketplace.proposeEngagement.referenceLabel")}
                  extra={t("marketplace.proposeEngagement.referenceExtra")}
                >
                  <Input
                    maxLength={200}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="PO-2026-…"
                  />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={submitting}
                >
                  {t("marketplace.proposeEngagement.submit")}
                </Button>
              </Form>
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
