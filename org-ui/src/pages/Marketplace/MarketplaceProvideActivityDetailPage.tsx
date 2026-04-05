import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Descriptions,
	Form,
	Input,
	Modal,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	MarketplaceIncomingSubscription,
	ProviderApproveSubscriptionRequest,
	ProviderRejectSubscriptionRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Text } = Typography;
const { TextArea } = Input;

function subscriptionStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "provider_review":
		case "admin_review":
		case "awaiting_contract":
		case "awaiting_payment":
		case "requested":
			return "gold";
		case "rejected":
		case "cancelled":
			return "red";
		case "expired":
			return "default";
		default:
			return "default";
	}
}

export function MarketplaceProvideActivityDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const { capability_slug, consumer_org_domain } = useParams<{
		capability_slug: string;
		consumer_org_domain: string;
	}>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [subscription, setSubscription] =
		useState<MarketplaceIncomingSubscription | null>(null);
	const [loading, setLoading] = useState(false);
	const [actionLoading, setActionLoading] = useState(false);
	const [rejectModalOpen, setRejectModalOpen] = useState(false);
	const [rejectNote, setRejectNote] = useState("");

	const loadSubscription = useCallback(async () => {
		if (!sessionToken || !capability_slug || !consumer_org_domain) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/incoming-subscriptions/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ consumer_org_domain, capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceIncomingSubscription = await resp.json();
				setSubscription(data);
			} else {
				message.error(t("provideActivityDetail.errors.loadFailed"));
			}
		} catch {
			message.error(t("provideActivityDetail.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, capability_slug, consumer_org_domain, message, t]);

	useEffect(() => {
		loadSubscription();
	}, [loadSubscription]);

	const handleApprove = async () => {
		if (!sessionToken || !capability_slug || !consumer_org_domain) return;
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ProviderApproveSubscriptionRequest = {
				consumer_org_domain,
				capability_slug,
			};
			const resp = await fetch(
				`${baseUrl}/org/marketplace/incoming-subscriptions/provider-approve`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 204) {
				message.success(t("provideActivityDetail.success.approved"));
				loadSubscription();
			} else {
				message.error(t("provideActivityDetail.errors.approveFailed"));
			}
		} catch {
			message.error(t("provideActivityDetail.errors.approveFailed"));
		} finally {
			setActionLoading(false);
		}
	};

	const handleReject = async () => {
		if (!sessionToken || !capability_slug || !consumer_org_domain) return;
		if (!rejectNote.trim()) {
			message.error(t("provideActivityDetail.errors.reviewNoteRequired"));
			return;
		}
		setActionLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: ProviderRejectSubscriptionRequest = {
				consumer_org_domain,
				capability_slug,
				review_note: rejectNote,
			};
			const resp = await fetch(
				`${baseUrl}/org/marketplace/incoming-subscriptions/provider-reject`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 204) {
				message.success(t("provideActivityDetail.success.rejected"));
				setRejectModalOpen(false);
				setRejectNote("");
				loadSubscription();
			} else {
				message.error(t("provideActivityDetail.errors.rejectFailed"));
			}
		} catch {
			message.error(t("provideActivityDetail.errors.rejectFailed"));
		} finally {
			setActionLoading(false);
		}
	};

	const canActOnSubscription =
		subscription?.status === "requested" ||
		subscription?.status === "provider_review";

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div style={{ marginBottom: 16 }}>
				<Link to={`/marketplace/provide/${capability_slug}/activity`}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("provideActivityDetail.backToActivity")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("provideActivityDetail.title")}
			</Title>

			<Spin spinning={loading}>
				{subscription && (
					<>
						<Descriptions
							column={{ xs: 1, sm: 2 }}
							bordered
							style={{ marginBottom: 24 }}
						>
							<Descriptions.Item label={t("provideActivityDetail.consumer")}>
								{subscription.consumer_org_domain}
							</Descriptions.Item>
							<Descriptions.Item label={t("provideActivityDetail.capability")}>
								{subscription.capability_slug}
							</Descriptions.Item>
							<Descriptions.Item label={t("provideActivityDetail.status")}>
								<Tag color={subscriptionStatusColor(subscription.status)}>
									{t(
										`provideActivityDetail.subscriptionStatuses.${subscription.status}`
									)}
								</Tag>
							</Descriptions.Item>
							<Descriptions.Item label={t("provideActivityDetail.createdAt")}>
								{new Date(subscription.created_at).toLocaleString()}
							</Descriptions.Item>
							<Descriptions.Item label={t("provideActivityDetail.updatedAt")}>
								{new Date(subscription.updated_at).toLocaleString()}
							</Descriptions.Item>
							{subscription.request_note && (
								<Descriptions.Item
									label={t("provideActivityDetail.requestNote")}
									span={2}
								>
									{subscription.request_note}
								</Descriptions.Item>
							)}
							{subscription.review_note && (
								<Descriptions.Item
									label={t("provideActivityDetail.reviewNote")}
									span={2}
								>
									{subscription.review_note}
								</Descriptions.Item>
							)}
						</Descriptions>

						{canManage && canActOnSubscription && (
							<Space>
								<Button
									type="primary"
									loading={actionLoading}
									onClick={handleApprove}
								>
									{t("provideActivityDetail.approveButton")}
								</Button>
								<Button
									danger
									loading={actionLoading}
									onClick={() => setRejectModalOpen(true)}
								>
									{t("provideActivityDetail.rejectButton")}
								</Button>
							</Space>
						)}
					</>
				)}
			</Spin>

			<Modal
				title={t("provideActivityDetail.rejectTitle")}
				open={rejectModalOpen}
				onCancel={() => {
					setRejectModalOpen(false);
					setRejectNote("");
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={actionLoading}>
					<Form layout="vertical">
						<Form.Item
							label={t("provideActivityDetail.rejectNoteLabel")}
							required
						>
							<TextArea
								rows={4}
								placeholder={t("provideActivityDetail.rejectNotePlaceholder")}
								value={rejectNote}
								onChange={(e) => setRejectNote(e.target.value)}
							/>
							{!rejectNote.trim() && (
								<Text type="danger">
									{t("provideActivityDetail.errors.reviewNoteRequired")}
								</Text>
							)}
						</Form.Item>
						<Button
							type="primary"
							danger
							loading={actionLoading}
							disabled={!rejectNote.trim()}
							onClick={handleReject}
							block
						>
							{t("provideActivityDetail.rejectButton")}
						</Button>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
