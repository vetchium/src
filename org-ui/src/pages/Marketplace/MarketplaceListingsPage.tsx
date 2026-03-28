import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CreateMarketplaceServiceListingRequest,
  ServiceListing,
  ServiceListingState,
  SubmitMarketplaceServiceListingAppealRequest,
  UpdateMarketplaceServiceListingRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text } = Typography;
const { TextArea } = Input;

type ListingFormValues = {
  name: string;
  short_blurb: string;
  description: string;
  service_category: string;
  countries_of_service: string;
  contact_url: string;
  pricing_info?: string;
  industries_served: string[];
  industries_served_other?: string;
  company_sizes_served: string[];
  job_functions_sourced: string[];
  seniority_levels_sourced: string[];
  geographic_sourcing_regions: string;
};

function stateColor(state: ServiceListingState): string {
  switch (state) {
    case "active":
      return "green";
    case "draft":
      return "default";
    case "pending_review":
      return "blue";
    case "paused":
      return "orange";
    case "rejected":
      return "red";
    case "suspended":
      return "volcano";
    case "appealing":
      return "purple";
    case "archived":
      return "gray";
    default:
      return "default";
  }
}

function canEdit(state: ServiceListingState): boolean {
  return ["draft", "active", "paused", "rejected"].includes(state);
}

function formValuesToRequest(
  values: ListingFormValues
): CreateMarketplaceServiceListingRequest {
  return {
    name: values.name,
    short_blurb: values.short_blurb,
    description: values.description,
    service_category: "talent_sourcing",
    countries_of_service: values.countries_of_service
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    contact_url: values.contact_url,
    pricing_info: values.pricing_info || undefined,
    industries_served: values.industries_served as never[],
    industries_served_other: values.industries_served_other || undefined,
    company_sizes_served: values.company_sizes_served as never[],
    job_functions_sourced: values.job_functions_sourced as never[],
    seniority_levels_sourced: values.seniority_levels_sourced as never[],
    geographic_sourcing_regions: values.geographic_sourcing_regions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

function listingToFormValues(listing: ServiceListing): ListingFormValues {
  return {
    name: listing.name,
    short_blurb: listing.short_blurb,
    description: listing.description,
    service_category: listing.service_category,
    countries_of_service: listing.countries_of_service.join(", "),
    contact_url: listing.contact_url,
    pricing_info: listing.pricing_info ?? "",
    industries_served: listing.industries_served,
    industries_served_other: listing.industries_served_other ?? "",
    company_sizes_served: listing.company_sizes_served,
    job_functions_sourced: listing.job_functions_sourced,
    seniority_levels_sourced: listing.seniority_levels_sourced,
    geographic_sourcing_regions: listing.geographic_sourcing_regions.join(", "),
  };
}

interface Props {
  hasCapability: boolean;
}

export function MarketplaceListingsPage({ hasCapability }: Props) {
  const { t } = useTranslation("marketplace");
  const { sessionToken } = useAuth();
  const { message } = App.useApp();

  const [listings, setListings] = useState<ServiceListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm] = Form.useForm<ListingFormValues>();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editingListing, setEditingListing] = useState<ServiceListing | null>(
    null
  );
  const [editForm] = Form.useForm<ListingFormValues>();

  const [appealModalOpen, setAppealModalOpen] = useState(false);
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealListingId, setAppealListingId] = useState<string>("");
  const [appealReason, setAppealReason] = useState("");

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const loadListings = useCallback(
    async (cursor?: string, reset?: boolean) => {
      if (!sessionToken) return;
      setLoading(true);
      try {
        const baseUrl = await getApiBaseUrl();
        const resp = await fetch(
          `${baseUrl}/org/list-marketplace-service-listings`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ ...(cursor ? { cursor } : {}) }),
          }
        );
        if (resp.status === 200) {
          const data = await resp.json();
          const items: ServiceListing[] = data.service_listings ?? [];
          if (reset) {
            setListings(items);
          } else {
            setListings((prev) => [...prev, ...items]);
          }
          setNextCursor(data.next_cursor ?? undefined);
        } else {
          message.error(t("listings.errors.loadFailed"));
        }
      } catch {
        message.error(t("listings.errors.loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [sessionToken, message, t]
  );

  useEffect(() => {
    loadListings(undefined, true);
  }, [loadListings]);

  const handleCreate = async (values: ListingFormValues) => {
    if (!sessionToken) return;
    setCreateLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const req: CreateMarketplaceServiceListingRequest =
        formValuesToRequest(values);
      const resp = await fetch(
        `${baseUrl}/org/create-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(req),
        }
      );
      if (resp.status === 201) {
        message.success(t("listings.success.created"));
        setCreateModalOpen(false);
        createForm.resetFields();
        loadListings(undefined, true);
      } else if (resp.status === 400) {
        const errs = await resp.json().catch(() => []);
        if (Array.isArray(errs) && errs.length > 0) {
          message.error(errs[0].message ?? t("listings.errors.createFailed"));
        } else {
          message.error(t("listings.errors.createFailed"));
        }
      } else {
        message.error(t("listings.errors.createFailed"));
      }
    } catch {
      message.error(t("listings.errors.createFailed"));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEdit = (listing: ServiceListing) => {
    setEditingListing(listing);
    editForm.setFieldsValue(listingToFormValues(listing));
    setEditModalOpen(true);
  };

  const handleUpdate = async (values: ListingFormValues) => {
    if (!sessionToken || !editingListing) return;
    setEditLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const req: UpdateMarketplaceServiceListingRequest = {
        service_listing_id: editingListing.service_listing_id,
        ...formValuesToRequest(values),
      };
      const resp = await fetch(
        `${baseUrl}/org/update-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(req),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.created"));
        setEditModalOpen(false);
        editForm.resetFields();
        setEditingListing(null);
        loadListings(undefined, true);
      } else if (resp.status === 400) {
        const errs = await resp.json().catch(() => []);
        if (Array.isArray(errs) && errs.length > 0) {
          message.error(errs[0].message ?? t("listings.errors.createFailed"));
        } else {
          message.error(t("listings.errors.createFailed"));
        }
      } else {
        message.error(t("listings.errors.createFailed"));
      }
    } catch {
      message.error(t("listings.errors.createFailed"));
    } finally {
      setEditLoading(false);
    }
  };

  const handleSubmit = async (id: string) => {
    if (!sessionToken) return;
    setActionLoadingId(id);
    try {
      const baseUrl = await getApiBaseUrl();
      const resp = await fetch(
        `${baseUrl}/org/submit-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ service_listing_id: id }),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.submitted"));
        loadListings(undefined, true);
      } else if (resp.status === 422) {
        message.error(t("listings.errors.submitFailed"));
      } else {
        message.error(t("listings.errors.submitFailed"));
      }
    } catch {
      message.error(t("listings.errors.submitFailed"));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handlePause = async (id: string) => {
    if (!sessionToken) return;
    setActionLoadingId(id);
    try {
      const baseUrl = await getApiBaseUrl();
      const resp = await fetch(
        `${baseUrl}/org/pause-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ service_listing_id: id }),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.paused"));
        loadListings(undefined, true);
      } else if (resp.status === 422) {
        message.error(t("listings.errors.pauseFailed"));
      } else {
        message.error(t("listings.errors.pauseFailed"));
      }
    } catch {
      message.error(t("listings.errors.pauseFailed"));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleUnpause = async (id: string) => {
    if (!sessionToken) return;
    setActionLoadingId(id);
    try {
      const baseUrl = await getApiBaseUrl();
      const resp = await fetch(
        `${baseUrl}/org/unpause-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ service_listing_id: id }),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.unpaused"));
        loadListings(undefined, true);
      } else if (resp.status === 422) {
        message.error(t("listings.errors.unpauseFailed"));
      } else {
        message.error(t("listings.errors.unpauseFailed"));
      }
    } catch {
      message.error(t("listings.errors.unpauseFailed"));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (id: string) => {
    if (!sessionToken) return;
    setActionLoadingId(id);
    try {
      const baseUrl = await getApiBaseUrl();
      const resp = await fetch(
        `${baseUrl}/org/archive-marketplace-service-listing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ service_listing_id: id }),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.archived"));
        loadListings(undefined, true);
      } else if (resp.status === 422) {
        message.error(t("listings.errors.archiveFailed"));
      } else {
        message.error(t("listings.errors.archiveFailed"));
      }
    } catch {
      message.error(t("listings.errors.archiveFailed"));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAppeal = async () => {
    if (!sessionToken || !appealListingId) return;
    if (!appealReason.trim()) {
      message.error(t("listings.errors.appealReasonRequired"));
      return;
    }
    if (appealReason.length > 2000) {
      message.error(t("listings.errors.appealReasonTooLong"));
      return;
    }
    setAppealLoading(true);
    try {
      const baseUrl = await getApiBaseUrl();
      const req: SubmitMarketplaceServiceListingAppealRequest = {
        service_listing_id: appealListingId,
        appeal_reason: appealReason,
      };
      const resp = await fetch(
        `${baseUrl}/org/submit-marketplace-service-listing-appeal`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify(req),
        }
      );
      if (resp.status === 200) {
        message.success(t("listings.success.appealed"));
        setAppealModalOpen(false);
        setAppealReason("");
        setAppealListingId("");
        loadListings(undefined, true);
      } else if (resp.status === 422) {
        message.error(t("listings.errors.appealAlreadyExhausted"));
      } else {
        message.error(t("listings.errors.appealFailed"));
      }
    } catch {
      message.error(t("listings.errors.appealFailed"));
    } finally {
      setAppealLoading(false);
    }
  };

  const industryOptions = [
    "technology_software",
    "finance_banking",
    "healthcare_life_sciences",
    "manufacturing_engineering",
    "retail_consumer_goods",
    "media_entertainment",
    "education_training",
    "legal_services",
    "consulting_professional_services",
    "real_estate_construction",
    "energy_utilities",
    "logistics_supply_chain",
    "government_public_sector",
    "nonprofit_ngo",
    "other",
  ].map((v) => ({ value: v, label: t(`listings.industries.${v}`) }));

  const companySizeOptions = ["startup", "smb", "enterprise"].map((v) => ({
    value: v,
    label: t(`listings.companySizes.${v}`),
  }));

  const jobFunctionOptions = [
    "engineering_technology",
    "sales_business_development",
    "marketing",
    "finance_accounting",
    "human_resources",
    "operations_supply_chain",
    "product_management",
    "design_creative",
    "legal_compliance",
    "customer_success_support",
    "data_analytics",
    "executive_general_management",
  ].map((v) => ({ value: v, label: t(`listings.jobFunctions.${v}`) }));

  const seniorityOptions = [
    "intern",
    "junior",
    "mid",
    "senior",
    "lead",
    "director",
    "c_suite",
  ].map((v) => ({ value: v, label: t(`listings.seniorityLevels.${v}`) }));

  const columns = [
    {
      title: t("listings.table.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("listings.table.category"),
      dataIndex: "service_category",
      key: "service_category",
      render: (cat: string) => t(`listings.serviceCategories.${cat}`),
    },
    {
      title: t("listings.table.state"),
      dataIndex: "state",
      key: "state",
      render: (state: ServiceListingState) => (
        <Tag color={stateColor(state)}>{t(`listings.states.${state}`)}</Tag>
      ),
    },
    {
      title: t("listings.table.createdAt"),
      dataIndex: "created_at",
      key: "created_at",
      render: (v: string) => new Date(v).toLocaleDateString(),
    },
    {
      title: t("listings.table.actions"),
      key: "actions",
      render: (_: unknown, record: ServiceListing) => {
        const id = record.service_listing_id;
        const isLoading = actionLoadingId === id;
        return (
          <Space size="small" wrap>
            {canEdit(record.state) && (
              <Button size="small" onClick={() => handleEdit(record)}>
                {t("listings.table.edit")}
              </Button>
            )}
            {record.state === "draft" && (
              <Button
                size="small"
                type="primary"
                loading={isLoading}
                onClick={() => handleSubmit(id)}
              >
                {t("listings.submit")}
              </Button>
            )}
            {record.state === "active" && (
              <Button
                size="small"
                loading={isLoading}
                onClick={() => handlePause(id)}
              >
                {t("listings.pause")}
              </Button>
            )}
            {record.state === "paused" && (
              <Button
                size="small"
                type="primary"
                loading={isLoading}
                onClick={() => handleUnpause(id)}
              >
                {t("listings.unpause")}
              </Button>
            )}
            {record.state === "suspended" && !record.appeal_exhausted && (
              <Button
                size="small"
                onClick={() => {
                  setAppealListingId(id);
                  setAppealModalOpen(true);
                }}
              >
                {t("listings.appeal")}
              </Button>
            )}
            {[
              "active",
              "paused",
              "rejected",
              "suspended",
              "appealing",
              "draft",
            ].includes(record.state) && (
              <Button
                size="small"
                danger
                loading={isLoading}
                onClick={() => handleArchive(id)}
              >
                {t("listings.archive")}
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  const listingForm = (
    form: ReturnType<typeof Form.useForm<ListingFormValues>>[0],
    onFinish: (values: ListingFormValues) => void,
    submitting: boolean
  ) => {
    return (
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="name"
          label={t("listings.name")}
          rules={[
            { required: true, message: t("listings.errors.nameRequired") },
            { max: 100, message: t("listings.errors.nameTooLong") },
          ]}
        >
          <Input placeholder={t("listings.namePlaceholder")} />
        </Form.Item>

        <Form.Item
          name="short_blurb"
          label={t("listings.shortBlurb")}
          rules={[
            {
              required: true,
              message: t("listings.errors.shortBlurbRequired"),
            },
            { max: 250, message: t("listings.errors.shortBlurbTooLong") },
          ]}
        >
          <Input placeholder={t("listings.shortBlurbPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="description"
          label={t("listings.description")}
          rules={[
            {
              required: true,
              message: t("listings.errors.descriptionRequired"),
            },
            { max: 5000, message: t("listings.errors.descriptionTooLong") },
          ]}
        >
          <TextArea
            rows={4}
            placeholder={t("listings.descriptionPlaceholder")}
          />
        </Form.Item>

        <Form.Item
          name="contact_url"
          label={t("listings.contactUrl")}
          rules={[
            {
              required: true,
              message: t("listings.errors.contactUrlRequired"),
            },
            {
              pattern: /^https:\/\/.+/,
              message: t("listings.errors.contactUrlInvalid"),
            },
          ]}
        >
          <Input placeholder={t("listings.contactUrlPlaceholder")} />
        </Form.Item>

        <Form.Item
          name="countries_of_service"
          label={t("listings.countriesOfService")}
          rules={[
            {
              required: true,
              message: t("listings.errors.countriesRequired"),
            },
          ]}
        >
          <Input placeholder={t("listings.countriesOfServicePlaceholder")} />
        </Form.Item>

        <Form.Item
          name="geographic_sourcing_regions"
          label={t("listings.geographicSourcingRegions")}
          rules={[
            {
              required: true,
              message: t("listings.errors.geographicRegionsRequired"),
            },
          ]}
        >
          <Input
            placeholder={t("listings.geographicSourcingRegionsPlaceholder")}
          />
        </Form.Item>

        <Form.Item
          name="industries_served"
          label={t("listings.industriesServed")}
          rules={[
            {
              required: true,
              message: t("listings.errors.industriesRequired"),
              type: "array",
              min: 1,
            },
          ]}
        >
          <Select
            mode="multiple"
            options={industryOptions}
            placeholder={t("listings.industriesServed")}
          />
        </Form.Item>

        <Form.Item noStyle shouldUpdate>
          {() => {
            const industries = form.getFieldValue(
              "industries_served"
            ) as string[];
            const hasOther = industries?.includes("other");
            return (
              hasOther && (
                <Form.Item
                  name="industries_served_other"
                  label={t("listings.industriesServedOther")}
                  rules={[
                    {
                      required: true,
                      message: t("listings.errors.industriesOtherRequired"),
                    },
                    {
                      max: 100,
                      message: t("listings.errors.industriesOtherTooLong"),
                    },
                  ]}
                >
                  <Input
                    placeholder={t("listings.industriesServedOtherPlaceholder")}
                  />
                </Form.Item>
              )
            );
          }}
        </Form.Item>

        {/* Suppress unused variable warning */}
        <Form.Item
          name="company_sizes_served"
          label={t("listings.companySizesServed")}
          rules={[
            {
              required: true,
              message: t("listings.errors.companySizesRequired"),
              type: "array",
              min: 1,
            },
          ]}
        >
          <Select
            mode="multiple"
            options={companySizeOptions}
            placeholder={t("listings.companySizesServed")}
          />
        </Form.Item>

        <Form.Item
          name="job_functions_sourced"
          label={t("listings.jobFunctionsSourced")}
          rules={[
            {
              required: true,
              message: t("listings.errors.jobFunctionsRequired"),
              type: "array",
              min: 1,
            },
          ]}
        >
          <Select
            mode="multiple"
            options={jobFunctionOptions}
            placeholder={t("listings.jobFunctionsSourced")}
          />
        </Form.Item>

        <Form.Item
          name="seniority_levels_sourced"
          label={t("listings.seniorityLevelsSourced")}
          rules={[
            {
              required: true,
              message: t("listings.errors.seniorityLevelsRequired"),
              type: "array",
              min: 1,
            },
          ]}
        >
          <Select
            mode="multiple"
            options={seniorityOptions}
            placeholder={t("listings.seniorityLevelsSourced")}
          />
        </Form.Item>

        <Form.Item
          name="pricing_info"
          label={t("listings.pricingInfo")}
          rules={[
            { max: 500, message: t("listings.errors.pricingInfoTooLong") },
          ]}
        >
          <TextArea
            rows={2}
            placeholder={t("listings.pricingInfoPlaceholder")}
          />
        </Form.Item>

        <Form.Item shouldUpdate>
          {() => (
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={form
                .getFieldsError()
                .some(({ errors }) => errors.length > 0)}
              block
            >
              {t("listings.table.edit")}
            </Button>
          )}
        </Form.Item>
      </Form>
    );
  };

  if (!hasCapability) {
    return (
      <Alert
        title={t("listings.noCapability")}
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {t("listings.title")}
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalOpen(true)}
        >
          {t("listings.addButton")}
        </Button>
      </div>

      <Spin spinning={loading}>
        <Table
          dataSource={listings}
          columns={columns}
          rowKey="service_listing_id"
          pagination={false}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: "8px 0" }}>
                {record.last_review_admin_note && (
                  <Alert
                    title={`${t("listings.lastReviewNote")}: ${record.last_review_admin_note}`}
                    type="info"
                    style={{ marginBottom: 8 }}
                  />
                )}
                {record.appeal_exhausted && (
                  <Alert
                    title={t("listings.errors.appealAlreadyExhausted")}
                    type="warning"
                  />
                )}
              </div>
            ),
            rowExpandable: (record) =>
              !!(record.last_review_admin_note || record.appeal_exhausted),
          }}
        />
      </Spin>

      {nextCursor && (
        <Button
          onClick={() => loadListings(nextCursor, false)}
          loading={loading}
          block
          style={{ marginTop: 16 }}
        >
          {t("listings.loadMore")}
        </Button>
      )}

      {/* Create Modal */}
      <Modal
        title={t("listings.createTitle")}
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        footer={null}
        destroyOnHidden
        width={700}
      >
        <Spin spinning={createLoading}>
          {listingForm(createForm, handleCreate, createLoading)}
        </Spin>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title={t("listings.editTitle")}
        open={editModalOpen}
        onCancel={() => {
          setEditModalOpen(false);
          editForm.resetFields();
          setEditingListing(null);
        }}
        footer={null}
        destroyOnHidden
        width={700}
      >
        <Spin spinning={editLoading}>
          {listingForm(editForm, handleUpdate, editLoading)}
        </Spin>
      </Modal>

      {/* Appeal Modal */}
      <Modal
        title={t("listings.appeal")}
        open={appealModalOpen}
        onCancel={() => {
          setAppealModalOpen(false);
          setAppealReason("");
          setAppealListingId("");
        }}
        footer={null}
        destroyOnHidden
      >
        <Spin spinning={appealLoading}>
          <Form layout="vertical">
            <Form.Item label={t("listings.appealReason")} required>
              <TextArea
                rows={4}
                placeholder={t("listings.appealReasonPlaceholder")}
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                maxLength={2100}
              />
              {appealReason.length > 2000 && (
                <Text type="danger">
                  {t("listings.errors.appealReasonTooLong")}
                </Text>
              )}
            </Form.Item>
            <Button
              type="primary"
              loading={appealLoading}
              disabled={!appealReason.trim() || appealReason.length > 2000}
              onClick={handleAppeal}
              block
            >
              {t("listings.appeal")}
            </Button>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
}
