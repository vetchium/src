import { ArrowLeftOutlined } from "@ant-design/icons";
import { App, Button, Card, Col, Row, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type {
	ListMarketplaceCapabilitiesRequest,
	MarketplaceCapability,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Paragraph, Text } = Typography;

function capabilityStatusColor(status: string): string {
	switch (status) {
		case "active":
			return "green";
		case "draft":
			return "default";
		case "disabled":
			return "red";
		default:
			return "default";
	}
}

export function MarketplaceCapabilitiesPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();

	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [loading, setLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>(undefined);

	const loadCapabilities = useCallback(
		async (paginationKey?: string, reset?: boolean) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListMarketplaceCapabilitiesRequest = {
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const resp = await fetch(
					`${baseUrl}/org/marketplace/capabilities/list`,
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
					const data = await resp.json();
					const items: MarketplaceCapability[] = data.capabilities ?? [];
					if (reset) {
						setCapabilities(items);
					} else {
						setCapabilities((prev) => [...prev, ...items]);
					}
					setNextPaginationKey(data.next_pagination_key ?? undefined);
				} else {
					message.error(t("capabilities.errors.loadFailed"));
				}
			} catch {
				message.error(t("capabilities.errors.loadFailed"));
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, message, t]
	);

	useEffect(() => {
		loadCapabilities(undefined, true);
	}, [loadCapabilities]);

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
				<Link to="/marketplace">
					<Button icon={<ArrowLeftOutlined />}>
						{t("capabilities.backToMarketplace")}
					</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("capabilities.title")}
			</Title>

			<Spin spinning={loading}>
				{capabilities.length === 0 && !loading ? (
					<Text type="secondary">{t("capabilities.errors.loadFailed")}</Text>
				) : (
					<Row gutter={[16, 16]}>
						{capabilities.map((cap) => (
							<Col key={cap.capability_slug} xs={24} sm={12} lg={8}>
								<Card
									hoverable
									style={{ height: "100%", cursor: "pointer" }}
									onClick={() =>
										navigate(
											`/marketplace/capabilities/${cap.capability_slug}`
										)
									}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "flex-start",
											marginBottom: 8,
										}}
									>
										<Title level={5} style={{ margin: 0 }}>
											{cap.display_name}
										</Title>
										<Tag color={capabilityStatusColor(cap.status)}>
											{t(`capabilities.status.${cap.status}`)}
										</Tag>
									</div>
									<Paragraph
										ellipsis={{ rows: 3 }}
										type="secondary"
										style={{ marginBottom: 12 }}
									>
										{cap.description}
									</Paragraph>
									{cap.pricing_hint && (
										<Text type="secondary" style={{ fontSize: 12 }}>
											{cap.pricing_hint}
										</Text>
									)}
									<div style={{ marginTop: 12 }}>
										<Button
											type="primary"
											size="small"
											onClick={(e) => {
												e.stopPropagation();
												navigate(
													`/marketplace/capabilities/${cap.capability_slug}`
												);
											}}
										>
											{t("capabilities.viewProviders")}
										</Button>
									</div>
								</Card>
							</Col>
						))}
					</Row>
				)}
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={() => loadCapabilities(nextPaginationKey, false)}
					loading={loading}
					block
					style={{ marginTop: 16 }}
				>
					{t("capabilities.loadMore")}
				</Button>
			)}
		</div>
	);
}
