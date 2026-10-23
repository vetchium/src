import { CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  Affix,
  Alert,
  App,
  Breadcrumb,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { countryCodeValues } from "typespec/common/countries";
import {
  type CheckType,
  checkTypeValues,
} from "typespec/orgs/hiring/vocabulary";
import { isCapability } from "typespec/orgs/marketplace/capabilities";
import type { Listing } from "typespec/orgs/marketplace/listings";
import {
  maxConsentDisclosure,
  maxDescription,
  maxHeadline,
  maxIndicativePrice,
  maxLanguages,
  maxServiceCountries,
} from "typespec/orgs/marketplace/listings";
import { allowsListings } from "typespec/orgs/subscriptions/plans";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import { languageOptions } from "../features/marketplace/languageOptions";
import {
  capabilityColors,
  capabilityLabel,
  checkTypeLabel,
  listingStateColors,
  listingStateLabel,
} from "../features/marketplace/presentation";
import {
  useCreateListingMutation,
  useMyListingsQuery,
  usePublishListingMutation,
  useUpdateListingMutation,
} from "../features/marketplace/queries";

export function ListingEditorPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { capability: capParam } = useParams<{ capability: string }>();
  const { message: toast } = App.useApp();

  const validCap = capParam && isCapability(capParam) ? capParam : undefined;

  const myInfoQuery = useMyInfoQuery();
  const me = myInfoQuery.data;

  const listingsQuery = useMyListingsQuery(
    me !== undefined && allowsListings(me.plan_oid),
  );
  const createMutation = useCreateListingMutation();
  const updateMutation = useUpdateListingMutation();
  const publishMutation = usePublishListingMutation();

  const createKey = useIdempotencyKey("create-listing");
  const updateKey = useIdempotencyKey("update-listing");
  const publishKey = useIdempotencyKey("publish-listing");

  const existingListing: Listing | undefined = useMemo(() => {
    if (!validCap || !listingsQuery.data) return undefined;
    return listingsQuery.data.listings.find((l) => l.capability === validCap);
  }, [validCap, listingsQuery.data]);

  // Form state
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [worldwide, setWorldwide] = useState(true);
  const [countries, setCountries] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [indicativePrice, setIndicativePrice] = useState("");
  const [checkTypes, setCheckTypes] = useState<CheckType[]>([]);
  const [consentDisclosure, setConsentDisclosure] = useState("");
  const [initialLoaded, setInitialLoaded] = useState(false);

  useEffect(() => {
    if (existingListing && !initialLoaded) {
      setHeadline(existingListing.headline);
      setDescription(existingListing.description);
      setWorldwide(existingListing.service.worldwide);
      setCountries(existingListing.service.countries);
      setLanguages(existingListing.languages);
      setIndicativePrice(existingListing.indicative_price || "");
      if (existingListing.check_types) {
        setCheckTypes(existingListing.check_types);
      }
      if (existingListing.consent_disclosure) {
        setConsentDisclosure(existingListing.consent_disclosure);
      }
      setInitialLoaded(true);
    }
  }, [existingListing, initialLoaded]);

  const countryNames = useMemo(
    () => new Intl.DisplayNames([i18n.language], { type: "region" }),
    [i18n.language],
  );

  const countrySelectOptions = useMemo(() => {
    return countryCodeValues.map((code) => ({
      value: code,
      label: countryNames.of(code) ?? code,
    }));
  }, [countryNames]);

  const languageSelectOptions = useMemo(
    () => languageOptions(i18n.language),
    [i18n.language],
  );

  if (!validCap) {
    return (
      <Alert
        type="error"
        showIcon
        title={t("marketplace.listingEditor.invalidCapability")}
      />
    );
  }

  if (myInfoQuery.isLoading) {
    return <Card loading />;
  }

  if (!me || !allowsListings(me.plan_oid)) {
    navigate(paths.listings);
    return null;
  }

  // Validation rules
  const trimmedHeadline = headline.trim();
  const trimmedDescription = description.trim();
  const isHeadlineValid =
    trimmedHeadline.length >= 1 && trimmedHeadline.length <= maxHeadline;
  const isDescriptionValid =
    trimmedDescription.length >= 1 &&
    trimmedDescription.length <= maxDescription;
  const isServiceValid =
    worldwide ||
    (countries.length >= 1 && countries.length <= maxServiceCountries);
  const isLanguagesValid = languages.length <= maxLanguages;
  const isPriceValid = indicativePrice.trim().length <= maxIndicativePrice;

  const isCheckTypesValid =
    validCap !== "background_check" || checkTypes.length >= 1;
  const trimmedDisclosure = consentDisclosure.trim();
  const isDisclosureValid =
    validCap !== "background_check" ||
    (trimmedDisclosure.length >= 1 &&
      trimmedDisclosure.length <= maxConsentDisclosure);

  const checklist = [
    {
      id: "headline",
      label: t("marketplace.listingEditor.checklist.headline"),
      valid: isHeadlineValid,
    },
    {
      id: "description",
      label: t("marketplace.listingEditor.checklist.description"),
      valid: isDescriptionValid,
    },
    {
      id: "service",
      label: t("marketplace.listingEditor.checklist.serviceArea"),
      valid: isServiceValid,
    },
    ...(validCap === "background_check"
      ? [
          {
            id: "checkTypes",
            label: t("marketplace.listingEditor.checklist.checkTypes"),
            valid: isCheckTypesValid,
          },
          {
            id: "disclosure",
            label: t("marketplace.listingEditor.checklist.disclosure"),
            valid: isDisclosureValid,
          },
        ]
      : []),
  ];

  const validCount = checklist.filter((item) => item.valid).length;
  const progressPercent = Math.round((validCount / checklist.length) * 100);
  const isReadyToPublish =
    checklist.every((item) => item.valid) && isLanguagesValid && isPriceValid;

  const handleSave = async (publishAfter = false) => {
    try {
      let savedListing: Listing;
      const content = {
        headline: trimmedHeadline,
        description: trimmedDescription,
        service: {
          worldwide,
          countries: worldwide ? [] : countries,
        },
        languages,
        ...(indicativePrice.trim() && {
          indicative_price: indicativePrice.trim(),
        }),
        ...(validCap === "background_check" && {
          check_types: checkTypes,
          consent_disclosure: trimmedDisclosure,
        }),
      };

      if (!existingListing) {
        savedListing = await createMutation.mutateAsync({
          request: {
            capability: validCap,
            ...content,
          },
          key: createKey.current(),
        });
        createKey.rotate();
      } else {
        savedListing = await updateMutation.mutateAsync({
          request: {
            capability: validCap,
            version: existingListing.version,
            ...content,
          },
          key: updateKey.current(),
        });
        updateKey.rotate();
      }

      if (publishAfter && savedListing.state !== "listed") {
        await publishMutation.mutateAsync({
          request: {
            capability: validCap,
            version: savedListing.version,
          },
          key: publishKey.current(),
        });
        publishKey.rotate();
        void toast.success(t("marketplace.listings.publishSuccess"));
      } else {
        void toast.success(t("marketplace.listingEditor.saveSuccess"));
      }

      navigate(paths.listings);
    } catch {
      void toast.error(t("marketplace.listingEditor.saveError"));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Breadcrumb
        items={[
          {
            title: (
              <Link to={paths.listings}>{t("marketplace.listings.title")}</Link>
            ),
          },
          { title: capabilityLabel(t, validCap) },
        ]}
      />

      <Flex justify="space-between" align="center" wrap gap="middle">
        <div>
          <Flex gap="small" align="center">
            <Typography.Title level={2} style={{ marginBottom: 0 }}>
              {t("marketplace.listingEditor.title", {
                capability: capabilityLabel(t, validCap),
              })}
            </Typography.Title>
            <Tag color={capabilityColors[validCap]}>
              {capabilityLabel(t, validCap)}
            </Tag>
            {existingListing && (
              <Tag color={listingStateColors[existingListing.state]}>
                {listingStateLabel(t, existingListing.state)}
              </Tag>
            )}
          </Flex>
          <Typography.Text type="secondary">
            {t("marketplace.listingEditor.intro")}
          </Typography.Text>
        </div>
      </Flex>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={16}>
          <Flex vertical gap="middle">
            <Card title={t("marketplace.listingEditor.basicsTitle")}>
              <Form layout="vertical">
                <Form.Item
                  label={t("marketplace.listingEditor.headlineLabel")}
                  required
                  extra={t("marketplace.listingEditor.headlineExtra")}
                  validateStatus={
                    headline.length > 0 && !isHeadlineValid
                      ? "error"
                      : undefined
                  }
                >
                  <Input
                    maxLength={maxHeadline}
                    showCount
                    value={headline}
                    onChange={(e) => setHeadline(e.target.value)}
                    placeholder={t(
                      "marketplace.listingEditor.headlinePlaceholder",
                    )}
                  />
                </Form.Item>

                <Form.Item
                  label={t("marketplace.listingEditor.descriptionLabel")}
                  required
                  extra={t("marketplace.listingEditor.descriptionExtra")}
                  validateStatus={
                    description.length > 0 && !isDescriptionValid
                      ? "error"
                      : undefined
                  }
                >
                  <Input.TextArea
                    rows={6}
                    maxLength={maxDescription}
                    showCount
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t(
                      "marketplace.listingEditor.descriptionPlaceholder",
                    )}
                  />
                </Form.Item>
              </Form>
            </Card>

            <Card title={t("marketplace.listingEditor.coverageTitle")}>
              <Form layout="vertical">
                <Form.Item
                  label={t("marketplace.listingEditor.serviceAreaLabel")}
                  required
                  extra={t("marketplace.listingEditor.serviceAreaExtra")}
                >
                  <Radio.Group
                    value={worldwide ? "worldwide" : "countries"}
                    onChange={(e) =>
                      setWorldwide(e.target.value === "worldwide")
                    }
                    options={[
                      {
                        value: "worldwide",
                        label: t("marketplace.listingDetail.worldwide"),
                      },
                      {
                        value: "countries",
                        label: t("marketplace.listingEditor.selectedCountries"),
                      },
                    ]}
                  />
                  {!worldwide && (
                    <Select
                      mode="multiple"
                      style={{ marginTop: 8, width: "100%" }}
                      placeholder={t(
                        "marketplace.listingEditor.selectCountriesPlaceholder",
                      )}
                      value={countries}
                      onChange={setCountries}
                      options={countrySelectOptions}
                      filterOption={(input, option) =>
                        String(option?.label ?? "")
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      maxTagCount="responsive"
                    />
                  )}
                </Form.Item>

                <Form.Item
                  label={t("marketplace.listingEditor.languagesLabel")}
                  extra={t("marketplace.listingEditor.languagesExtra")}
                >
                  <Select
                    id="languages-select"
                    aria-label="Languages"
                    mode="multiple"
                    style={{ width: "100%" }}
                    placeholder={t(
                      "marketplace.listingEditor.selectLanguagesPlaceholder",
                    )}
                    value={languages}
                    onChange={setLanguages}
                    options={languageSelectOptions}
                    filterOption={(input, option) =>
                      String(option?.label ?? "")
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                    maxTagCount="responsive"
                  />
                </Form.Item>

                <Form.Item
                  label={t("marketplace.listingEditor.priceLabel")}
                  extra={t("marketplace.listingEditor.priceExtra")}
                >
                  <Input
                    maxLength={maxIndicativePrice}
                    value={indicativePrice}
                    onChange={(e) => setIndicativePrice(e.target.value)}
                    placeholder={t(
                      "marketplace.listingEditor.pricePlaceholder",
                    )}
                  />
                </Form.Item>
              </Form>
            </Card>

            {validCap === "background_check" && (
              <Card title={t("marketplace.listingEditor.checksTitle")}>
                <Form layout="vertical">
                  <Form.Item
                    label={t("marketplace.listingEditor.checkTypesLabel")}
                    required
                    extra={t("marketplace.listingEditor.checkTypesExtra")}
                    validateStatus={
                      checkTypes.length === 0 ? "warning" : undefined
                    }
                  >
                    <Checkbox.Group
                      value={checkTypes}
                      onChange={(vals) => setCheckTypes(vals as CheckType[])}
                      options={checkTypeValues.map((type) => ({
                        value: type,
                        label: checkTypeLabel(t, type),
                      }))}
                    />
                  </Form.Item>

                  <Form.Item
                    label={t("marketplace.listingEditor.disclosureLabel")}
                    required
                    extra={t("marketplace.listingEditor.disclosureExtra")}
                    validateStatus={
                      consentDisclosure.length > 0 && !isDisclosureValid
                        ? "error"
                        : undefined
                    }
                  >
                    <Input.TextArea
                      rows={6}
                      maxLength={maxConsentDisclosure}
                      showCount
                      value={consentDisclosure}
                      onChange={(e) => setConsentDisclosure(e.target.value)}
                      placeholder={t(
                        "marketplace.listingEditor.disclosurePlaceholder",
                      )}
                    />
                  </Form.Item>
                </Form>
              </Card>
            )}
          </Flex>
        </Col>

        <Col xs={24} lg={8}>
          <Affix offsetTop={24}>
            <Card title={t("marketplace.listingEditor.actionsTitle")}>
              <Typography.Paragraph type="secondary">
                {t("marketplace.listingEditor.actionsIntro")}
              </Typography.Paragraph>

              <Flex vertical gap="small">
                <Button
                  type="primary"
                  block
                  disabled={!isReadyToPublish}
                  loading={
                    createMutation.isPending ||
                    updateMutation.isPending ||
                    publishMutation.isPending
                  }
                  onClick={() => void handleSave(true)}
                >
                  {existingListing?.state === "listed"
                    ? t("common.save")
                    : t("marketplace.listings.publish")}
                </Button>
                <Button
                  block
                  loading={createMutation.isPending || updateMutation.isPending}
                  onClick={() => void handleSave(false)}
                >
                  {t("marketplace.listingEditor.saveDraft")}
                </Button>
                <Button block onClick={() => navigate(paths.listings)}>
                  {t("common.cancel")}
                </Button>
              </Flex>

              <Divider />

              <Flex justify="space-between" align="center">
                <Typography.Text strong>
                  {t("marketplace.listingEditor.readiness")}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {validCount} / {checklist.length}
                </Typography.Text>
              </Flex>
              <Progress percent={progressPercent} size="small" />

              <Flex vertical gap={6} style={{ marginTop: 12 }}>
                {checklist.map((item) => (
                  <Flex key={item.id} gap="small" align="center">
                    {item.valid ? (
                      <CheckCircleFilled style={{ color: "#16a34a" }} />
                    ) : (
                      <CloseCircleFilled style={{ color: "#9ca3af" }} />
                    )}
                    <Typography.Text
                      type={item.valid ? undefined : "secondary"}
                    >
                      {item.label}
                    </Typography.Text>
                  </Flex>
                ))}
              </Flex>
            </Card>
          </Affix>
        </Col>
      </Row>
    </Space>
  );
}
