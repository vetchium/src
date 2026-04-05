import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Descriptions,
	Form,
	Input,
	Modal,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import type {
	MarketplaceOffer,
	RequestConsumerSubscriptionRequest,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

export function MarketplaceProviderOfferPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const { capability_slug, provider_org_domain } = useParams<{
		capability_slug: string;
		provider_org_domain: string;
	}>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [offer, setOffer] = useState<MarketplaceOffer | null>(null);
	const [loading, setLoading] = useState(false);
	const [subscribeModalOpen, setSubscribeModalOpen] = useState(false);
	const [subscribeLoading, setSubscribeLoading] = useState(false);
	const [requestNote, setRequestNote] = useState("");

	const loadOffer = useCallback(async () => {
		if (!sessionToken || !capability_slug || !provider_org_domain) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/providers/get-offer`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ provider_org_domain, capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceOffer = await resp.json();
				setOffer(data);
			} else {
				message.error(t("providerOffer.errors.loadFailed"));
			}
		} catch {
			message.error(t("providerOffer.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, capability_slug, provider_org_domain, message, t]);

	useEffect(() => {
		loadOffer();
	}, [loadOffer]);

	const handleSubscribe = async () => {
		if (!sessionToken || !capability_slug || !provider_org_domain) return;
		setSubscribeLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const req: RequestConsumerSubscriptionRequest = {
				provider_org_domain,
				capability_slug,
				...(requestNote ? { request_note: requestNote } : {}),
			};
			const resp = await fetch(
				`${baseUrl}/org/marketplace/consumer-subscriptions/request`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				}
			);
			if (resp.status === 200 || resp.status === 201) {
				message.success(t("providerOffer.success.subscribed"));
				setSubscribeModalOpen(false);
				setRequestNote("");
			} else if (resp.status === 409) {
				message.error(t("providerOffer.alreadySubscribed"));
				setSubscribeModalOpen(false);
			} else {
				message.error(t("providerOffer.errors.subscribeFailed"));
			}
		} catch {
			message.error(t("providerOffer.errors.subscribeFailed"));
		} finally {
			setSubscribeLoading(false);
		}
	};

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
				<Link to={`/marketplace/capabilities/${capability_slug}`}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("providerOffer.backToCapability")}
					</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{offer && (
					<>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "flex-start",
								marginBottom: 24,
							}}
						>
							<div>
								<Title level={2} style={{ margin: 0 }}>
									{offer.headline}
								</Title>
								<Text type="secondary">{provider_org_domain}</Text>
							</div>
							{canManage && (
								<Button
									type="primary"
									onClick={() => setSubscribeModalOpen(true)}
								>
									{t("providerOffer.subscribeButton")}
								</Button>
							)}
						</div>

						<Paragraph style={{ marginBottom: 24 }}>{offer.summary}</Paragraph>

						<Descriptions
							column={{ xs: 1, sm: 2 }}
							bordered
							style={{ marginBottom: 24 }}
						>
							<Descriptions.Item label={t("providerOffer.regions")}>
								{offer.regions_served.join(", ")}
							</Descriptions.Item>
							<Descriptions.Item label={t("providerOffer.contact")}>
								<Tag>
									{t(`capabilityDetail.contactModes.${offer.contact_mode}`)}
								</Tag>{" "}
								{offer.contact_value}
							</Descriptions.Item>
							{offer.pricing_hint && (
								<Descriptions.Item
									label={t("providerOffer.pricing")}
									span={2}
								>
									{offer.pricing_hint}
								</Descriptions.Item>
							)}
						</Descriptions>

						<Title level={4}>{t("providerOffer.description")}</Title>
						<Paragraph style={{ whiteSpace: "pre-wrap" }}>
							{offer.description}
						</Paragraph>
					</>
				)}
			</Spin>

			<Modal
				title={t("providerOffer.confirmSubscribe")}
				open={subscribeModalOpen}
				onCancel={() => {
					setSubscribeModalOpen(false);
					setRequestNote("");
				}}
				footer={null}
				destroyOnHidden
			>
				<Spin spinning={subscribeLoading}>
					<Paragraph>{t("providerOffer.subscribeConfirmMessage")}</Paragraph>
					<Form layout="vertical">
						<Form.Item label={t("providerOffer.requestNote")}>
							<TextArea
								rows={3}
								placeholder={t("providerOffer.requestNotePlaceholder")}
								value={requestNote}
								onChange={(e) => setRequestNote(e.target.value)}
								maxLength={1000}
							/>
						</Form.Item>
						<Button
							type="primary"
							loading={subscribeLoading}
							onClick={handleSubscribe}
							block
						>
							{t("providerOffer.subscribeButton")}
						</Button>
					</Form>
				</Spin>
			</Modal>
		</div>
	);
}
