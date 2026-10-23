import {
  CheckCircleFilled,
  EditOutlined,
  EyeOutlined,
  LockOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useIdempotencyKey } from "@vetchium/portal-ui/idempotency";
import {
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Modal,
  Row,
  Space,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  type Capability,
  capabilityValues,
} from "typespec/orgs/marketplace/capabilities";
import type { Listing } from "typespec/orgs/marketplace/listings";
import { allowsListings } from "typespec/orgs/subscriptions/plans";
import { paths } from "../app/paths";
import { useMyInfoQuery } from "../features/account/queries";
import {
  capabilityColors,
  capabilityLabel,
  listingStateColors,
  listingStateLabel,
} from "../features/marketplace/presentation";
import {
  useDeleteListingMutation,
  useMyListingsQuery,
  usePublishListingMutation,
  useUnlistListingMutation,
} from "../features/marketplace/queries";

export function ListingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { message: toast } = App.useApp();
  const myInfoQuery = useMyInfoQuery();
  const me = myInfoQuery.data;

  const listingsQuery = useMyListingsQuery(
    me !== undefined && allowsListings(me.plan_oid),
  );
  const publishMutation = usePublishListingMutation();
  const unlistMutation = useUnlistListingMutation();
  const deleteMutation = useDeleteListingMutation();

  const publishKey = useIdempotencyKey("publish-listing");
  const unlistKey = useIdempotencyKey("unlist-listing");
  const deleteKey = useIdempotencyKey("delete-listing");

  const [unlistTarget, setUnlistTarget] = useState<Listing>();
  const [deleteTarget, setDeleteTarget] = useState<Listing>();

  if (myInfoQuery.isLoading) {
    return <Card loading />;
  }

  // Free-plan screen (MKT-UI-003, ux.md)
  if (!me || !allowsListings(me.plan_oid)) {
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Typography.Title level={2} style={{ marginBottom: 4 }}>
            {t("marketplace.listings.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("marketplace.listings.intro")}
          </Typography.Text>
        </div>

        <Card>
          <Flex
            vertical
            align="center"
            gap="middle"
            style={{ padding: "32px 0", textAlign: "center" }}
          >
            <LockOutlined style={{ fontSize: 40, color: "#2563eb" }} />
            <Typography.Title level={3} style={{ margin: 0 }}>
              {t("marketplace.listings.planGateTitle")}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ maxWidth: 520 }}>
              {t("marketplace.listings.planGateDescription")}
            </Typography.Paragraph>
            <Flex vertical gap={6} align="start">
              {[
                t("marketplace.listings.planGateBenefit1"),
                t("marketplace.listings.planGateBenefit2"),
                t("marketplace.listings.planGateBenefit3"),
              ].map((text) => (
                <Flex key={text} gap="small" align="center">
                  <CheckCircleFilled style={{ color: "#16a34a" }} />
                  <Typography.Text>{text}</Typography.Text>
                </Flex>
              ))}
            </Flex>
            <Button
              type="primary"
              size="large"
              onClick={() => navigate(paths.plans)}
            >
              {t("marketplace.listings.comparePlans")}
            </Button>
            <Typography.Text type="secondary">
              {t("marketplace.listings.planGateNote")}
            </Typography.Text>
          </Flex>
        </Card>
      </Space>
    );
  }

  const existingByCap = new Map<Capability, Listing>();
  for (const item of listingsQuery.data?.listings ?? []) {
    existingByCap.set(item.capability, item);
  }

  const handlePublish = async (capability: Capability, version: number) => {
    try {
      await publishMutation.mutateAsync({
        request: { capability, version },
        key: publishKey.current(),
      });
      publishKey.rotate();
      void toast.success(t("marketplace.listings.publishSuccess"));
    } catch {
      void toast.error(t("marketplace.listings.publishError"));
    }
  };

  const handleUnlist = async () => {
    if (!unlistTarget) return;
    try {
      await unlistMutation.mutateAsync({
        request: {
          capability: unlistTarget.capability,
          version: unlistTarget.version,
        },
        key: unlistKey.current(),
      });
      unlistKey.rotate();
      setUnlistTarget(undefined);
      void toast.success(t("marketplace.listings.unlistSuccess"));
    } catch {
      void toast.error(t("marketplace.listings.unlistError"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({
        request: {
          capability: deleteTarget.capability,
          version: deleteTarget.version,
        },
        key: deleteKey.current(),
      });
      deleteKey.rotate();
      setDeleteTarget(undefined);
      void toast.success(t("marketplace.listings.deleteSuccess"));
    } catch {
      void toast.error(t("marketplace.listings.deleteError"));
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {t("marketplace.listings.title")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t("marketplace.listings.intro")}
        </Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        {capabilityValues.map((cap) => {
          const listing = existingByCap.get(cap);

          if (!listing) {
            return (
              <Col xs={24} md={12} key={cap}>
                <Card
                  title={
                    <Tag color={capabilityColors[cap]}>
                      {capabilityLabel(t, cap)}
                    </Tag>
                  }
                  actions={[
                    <Button
                      key="create"
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={() => navigate(paths.listingEditor(cap))}
                    >
                      {t("marketplace.listings.createListing")}
                    </Button>,
                  ]}
                  style={{ height: "100%" }}
                >
                  <Typography.Paragraph type="secondary">
                    {t(`marketplace.listings.emptyDescriptions.${cap}`)}
                  </Typography.Paragraph>
                </Card>
              </Col>
            );
          }

          return (
            <Col xs={24} md={12} key={cap}>
              <Card
                title={
                  <Flex gap="small" align="center">
                    <Tag color={capabilityColors[cap]}>
                      {capabilityLabel(t, cap)}
                    </Tag>
                    <Tag color={listingStateColors[listing.state]}>
                      {listingStateLabel(t, listing.state)}
                    </Tag>
                  </Flex>
                }
                actions={[
                  listing.state === "draft" ? (
                    <Flex key="draft-acts" justify="center" gap="small">
                      <Button
                        type="primary"
                        onClick={() => navigate(paths.listingEditor(cap))}
                      >
                        {t("marketplace.listings.continueEditing")}
                      </Button>
                      <Button
                        onClick={() => void handlePublish(cap, listing.version)}
                        loading={publishMutation.isPending}
                      >
                        {t("marketplace.listings.publish")}
                      </Button>
                      <Button
                        type="text"
                        danger
                        onClick={() => setDeleteTarget(listing)}
                      >
                        {t("marketplace.listings.deleteDraft")}
                      </Button>
                    </Flex>
                  ) : listing.state === "listed" ? (
                    <Flex key="listed-acts" justify="center" gap="small">
                      <Button
                        icon={<EditOutlined />}
                        onClick={() => navigate(paths.listingEditor(cap))}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button onClick={() => setUnlistTarget(listing)}>
                        {t("marketplace.listings.unlist")}
                      </Button>
                      <Button
                        icon={<EyeOutlined />}
                        onClick={() =>
                          navigate(
                            paths.listingDetail(me.org.domain.domain, cap),
                          )
                        }
                      >
                        {t("marketplace.listings.preview")}
                      </Button>
                    </Flex>
                  ) : (
                    <Flex key="unlisted-acts" justify="center" gap="small">
                      <Button
                        icon={<EditOutlined />}
                        onClick={() => navigate(paths.listingEditor(cap))}
                      >
                        {t("common.edit")}
                      </Button>
                      <Button
                        type="primary"
                        onClick={() => void handlePublish(cap, listing.version)}
                        loading={publishMutation.isPending}
                      >
                        {t("marketplace.listings.publish")}
                      </Button>
                      <Button
                        type="text"
                        danger
                        onClick={() => setDeleteTarget(listing)}
                      >
                        {t("common.delete")}
                      </Button>
                    </Flex>
                  ),
                ]}
                style={{ height: "100%" }}
              >
                <Typography.Text strong style={{ fontSize: 16 }}>
                  {listing.headline}
                </Typography.Text>

                <Descriptions
                  size="small"
                  column={1}
                  style={{ marginTop: 12 }}
                  items={[
                    {
                      key: "serves",
                      label: t("marketplace.listingDetail.serves"),
                      children: listing.service.worldwide
                        ? t("marketplace.listingDetail.worldwide")
                        : t("marketplace.listingDetail.selectedCountries", {
                            count: listing.service.countries.length,
                          }),
                    },
                    {
                      key: "languages",
                      label: t("marketplace.listingDetail.languages"),
                      children:
                        listing.languages.length > 0
                          ? listing.languages.join(", ")
                          : "—",
                    },
                    {
                      key: "price",
                      label: t("marketplace.listingDetail.pricing"),
                      children: listing.indicative_price || "—",
                    },
                  ]}
                />
              </Card>
            </Col>
          );
        })}
      </Row>

      <Modal
        title={t("marketplace.listings.unlistModalTitle")}
        open={unlistTarget !== undefined}
        onCancel={() => setUnlistTarget(undefined)}
        onOk={() => void handleUnlist()}
        okText={t("marketplace.listings.unlist")}
        okButtonProps={{ loading: unlistMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.listings.unlistModalText")}
        </Typography.Paragraph>
      </Modal>

      <Modal
        title={t("marketplace.listings.deleteModalTitle")}
        open={deleteTarget !== undefined}
        onCancel={() => setDeleteTarget(undefined)}
        onOk={() => void handleDelete()}
        okText={t("common.delete")}
        okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
      >
        <Typography.Paragraph>
          {t("marketplace.listings.deleteModalText")}
        </Typography.Paragraph>
      </Modal>
    </Space>
  );
}
