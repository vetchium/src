import { ArrowLeftOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { OrgCapability } from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { MarketplaceBrowsePage } from "./MarketplaceBrowsePage";

const { Title, Paragraph, Text } = Typography;

function statusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "pending_approval":
			return "gold";
		case "rejected":
		case "revoked":
			return "red";
		case "expired":
			return "orange";
		default:
			return "default";
	}
}

export function MarketplacePage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);
	const navigate = useNavigate();

	const hasProviderAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [capability, setCapability] = useState<OrgCapability | null>(null);
	const [capabilityLoaded, setCapabilityLoaded] = useState(false);

	const loadCapability = useCallback(async () => {
		if (!sessionToken || !hasProviderAccess) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(
				`${baseUrl}/org/get-marketplace-provider-capability`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({}),
				}
			);
			if (resp.status === 200) {
				const data: OrgCapability = await resp.json();
				setCapability(data);
			} else {
				setCapability(null);
			}
		} catch {
			setCapability(null);
		} finally {
			setCapabilityLoaded(true);
		}
	}, [sessionToken, hasProviderAccess]);

	useEffect(() => {
		if (hasProviderAccess) {
			loadCapability();
		}
	}, [loadCapability, hasProviderAccess]);

	const getCapabilityCardFooter = () => {
		if (!capabilityLoaded && hasProviderAccess) return null;
		if (capability?.status === "active") {
			return (
				<Text type="secondary" style={{ fontSize: 12 }}>
					{t("providerHub.clickToManage")}
				</Text>
			);
		}
		if (!capability) {
			return (
				<Text type="secondary" style={{ fontSize: 12 }}>
					{t("providerHub.clickToApply")}
				</Text>
			);
		}
		return (
			<Text type="secondary" style={{ fontSize: 12 }}>
				{t("providerHub.clickToView")}
			</Text>
		);
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
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("title")}
			</Title>

			{/* Provider Hub — visible only to superadmin / manage_marketplace */}
			{hasProviderAccess && (
				<section style={{ marginBottom: 48 }}>
					<Title level={3} style={{ marginBottom: 4 }}>
						{t("providerHub.title")}
					</Title>
					<Paragraph type="secondary" style={{ marginBottom: 24 }}>
						{t("providerHub.subtitle")}
					</Paragraph>

					<Row gutter={[24, 24]}>
						<Col xs={24} sm={12} md={8}>
							<Card
								hoverable
								onClick={() => navigate("/marketplace/capability")}
								style={{ height: "100%", cursor: "pointer" }}
							>
								<div
									style={{ display: "flex", alignItems: "flex-start", gap: 16 }}
								>
									<TeamOutlined
										style={{
											fontSize: 32,
											color: "#1890ff",
											marginTop: 2,
											flexShrink: 0,
										}}
									/>
									<div style={{ flex: 1 }}>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												flexWrap: "wrap",
												gap: 8,
												marginBottom: 8,
											}}
										>
											<Text strong style={{ fontSize: 16 }}>
												{t("providerHub.talentSourcing.title")}
											</Text>
											{capability && (
												<Tag color={statusColor(capability.status)}>
													{t(`capability.statuses.${capability.status}`)}
												</Tag>
											)}
										</div>
										<Paragraph
											type="secondary"
											style={{ margin: 0, marginBottom: 12 }}
										>
											{t("providerHub.talentSourcing.description")}
										</Paragraph>
										{getCapabilityCardFooter()}
									</div>
								</div>
							</Card>
						</Col>
					</Row>
				</section>
			)}

			{/* Browse Marketplace — visible to all authenticated users */}
			<section>
				<Title level={3} style={{ marginBottom: 4 }}>
					{t("browseSection")}
				</Title>
				<Paragraph type="secondary" style={{ marginBottom: 24 }}>
					{t("browseSectionSubtitle")}
				</Paragraph>
				<MarketplaceBrowsePage />
			</section>
		</div>
	);
}
