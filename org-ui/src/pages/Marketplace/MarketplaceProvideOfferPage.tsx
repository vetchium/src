import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Descriptions, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MarketplaceOffer } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Paragraph, Text } = Typography;

function offerStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_review":
			return "gold";
		case "draft":
			return "default";
		case "rejected":
		case "suspended":
			return "red";
		case "archived":
			return "default";
		default:
			return "default";
	}
}

export function MarketplaceProvideOfferPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const canManage =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [offer, setOffer] = useState<MarketplaceOffer | null>(null);
	const [loading, setLoading] = useState(false);

	const loadOffer = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/marketplace/provider-offers/get`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ capability_slug }),
				}
			);
			if (resp.status === 200) {
				const data: MarketplaceOffer = await resp.json();
				setOffer(data);
			} else {
				message.error(t("provideOffer.errors.loadFailed"));
			}
		} catch {
			message.error(t("provideOffer.errors.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [sessionToken, capability_slug, message, t]);

	useEffect(() => {
		loadOffer();
	}, [loadOffer]);

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
				<Link to={`/marketplace/provide/${capability_slug}`}>
					<Button icon={<ArrowLeftOutlined />}>
						{t("provideOffer.backToCapability")}
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
								<Tag
									color={offerStatusColor(offer.status)}
									style={{ marginTop: 8 }}
								>
									{t(`provideCapability.offerStatuses.${offer.status}`)}
								</Tag>
							</div>
							{canManage && (
								<Button
									type="primary"
									onClick={() =>
										navigate(
											`/marketplace/provide/${capability_slug}/offer/edit`
										)
									}
								>
									{t("provideOffer.editButton")}
								</Button>
							)}
						</div>

						<Paragraph style={{ marginBottom: 24 }}>{offer.summary}</Paragraph>

						<Descriptions
							column={{ xs: 1, sm: 2 }}
							bordered
							style={{ marginBottom: 24 }}
						>
							<Descriptions.Item label={t("provideOffer.regions")}>
								{offer.regions_served.join(", ")}
							</Descriptions.Item>
							<Descriptions.Item label={t("provideOffer.contact")}>
								<Tag>
									{t(`capabilityDetail.contactModes.${offer.contact_mode}`)}
								</Tag>{" "}
								{offer.contact_value}
							</Descriptions.Item>
							{offer.pricing_hint && (
								<Descriptions.Item
									label={t("provideOffer.pricing")}
									span={2}
								>
									{offer.pricing_hint}
								</Descriptions.Item>
							)}
							{offer.review_note && (
								<Descriptions.Item
									label={t("provideOffer.reviewNote")}
									span={2}
								>
									<Text type="danger">{offer.review_note}</Text>
								</Descriptions.Item>
							)}
						</Descriptions>

						<Title level={4}>{t("provideOffer.title")}</Title>
						<Paragraph style={{ whiteSpace: "pre-wrap" }}>
							{offer.description}
						</Paragraph>
					</>
				)}
			</Spin>
		</div>
	);
}
