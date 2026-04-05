import { ArrowLeftOutlined } from "@ant-design/icons";
import {
	App,
	Button,
	Card,
	Col,
	Descriptions,
	Row,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	ListMarketplaceProvidersRequest,
	MarketplaceCapability,
	MarketplaceProviderSummary,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Paragraph, Text } = Typography;

export function MarketplaceCapabilityDetailPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { message } = App.useApp();
	const navigate = useNavigate();
	const { capability_slug } = useParams<{ capability_slug: string }>();

	const [capability, setCapability] = useState<MarketplaceCapability | null>(
		null
	);
	const [capabilityLoading, setCapabilityLoading] = useState(false);
	const [providers, setProviders] = useState<MarketplaceProviderSummary[]>([]);
	const [providersLoading, setProvidersLoading] = useState(false);
	const [nextPaginationKey, setNextPaginationKey] = useState<
		string | undefined
	>(undefined);

	const loadCapability = useCallback(async () => {
		if (!sessionToken || !capability_slug) return;
		setCapabilityLoading(true);
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/capabilities/get`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({ capability_slug }),
			});
			if (resp.status === 200) {
				const data: MarketplaceCapability = await resp.json();
				setCapability(data);
			} else {
				message.error(t("capabilityDetail.errors.loadFailed"));
			}
		} catch {
			message.error(t("capabilityDetail.errors.loadFailed"));
		} finally {
			setCapabilityLoading(false);
		}
	}, [sessionToken, capability_slug, message, t]);

	const loadProviders = useCallback(
		async (paginationKey?: string, reset?: boolean) => {
			if (!sessionToken || !capability_slug) return;
			setProvidersLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const req: ListMarketplaceProvidersRequest = {
					capability_slug,
					limit: 20,
					...(paginationKey ? { pagination_key: paginationKey } : {}),
				};
				const resp = await fetch(`${baseUrl}/org/marketplace/providers/list`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify(req),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					const items: MarketplaceProviderSummary[] = data.providers ?? [];
					if (reset) {
						setProviders(items);
					} else {
						setProviders((prev) => [...prev, ...items]);
					}
					setNextPaginationKey(data.next_pagination_key ?? undefined);
				} else {
					message.error(t("capabilityDetail.errors.providersFailed"));
				}
			} catch {
				message.error(t("capabilityDetail.errors.providersFailed"));
			} finally {
				setProvidersLoading(false);
			}
		},
		[sessionToken, capability_slug, message, t]
	);

	useEffect(() => {
		loadCapability();
		loadProviders(undefined, true);
	}, [loadCapability, loadProviders]);

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
				<Link to="/marketplace/capabilities">
					<Button icon={<ArrowLeftOutlined />}>
						{t("capabilityDetail.backToCapabilities")}
					</Button>
				</Link>
			</div>

			<Spin spinning={capabilityLoading}>
				{capability && (
					<>
						<Title level={2} style={{ marginBottom: 8 }}>
							{capability.display_name}
						</Title>
						<Paragraph type="secondary" style={{ marginBottom: 24 }}>
							{capability.description}
						</Paragraph>
						{capability.pricing_hint && (
							<Text type="secondary">{capability.pricing_hint}</Text>
						)}
					</>
				)}
			</Spin>

			<Title level={3} style={{ marginTop: 32, marginBottom: 16 }}>
				{t("capabilityDetail.providersTitle")}
			</Title>

			<Spin spinning={providersLoading}>
				{providers.length === 0 && !providersLoading ? (
					<Text type="secondary">{t("capabilityDetail.noProviders")}</Text>
				) : (
					<Row gutter={[16, 16]}>
						{providers.map((provider) => (
							<Col
								key={`${provider.provider_org_domain}/${provider.capability_slug}`}
								xs={24}
								sm={12}
								lg={8}
							>
								<Card
									hoverable
									style={{ height: "100%" }}
									actions={[
										<Button
											key="view"
											type="link"
											onClick={() =>
												navigate(
													`/marketplace/capabilities/${capability_slug}/providers/${provider.provider_org_domain}`
												)
											}
										>
											{t("capabilityDetail.viewOffer")}
										</Button>,
									]}
								>
									<Title level={5} style={{ marginBottom: 8 }}>
										{provider.provider_org_domain}
									</Title>
									<Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 8 }}>
										{provider.headline}
									</Paragraph>
									<Paragraph
										ellipsis={{ rows: 3 }}
										type="secondary"
										style={{ marginBottom: 8 }}
									>
										{provider.summary}
									</Paragraph>
									<Descriptions size="small" column={1}>
										<Descriptions.Item
											label={t("capabilityDetail.regions")}
										>
											{provider.regions_served.join(", ")}
										</Descriptions.Item>
										<Descriptions.Item
											label={t("capabilityDetail.contact")}
										>
											<Tag>
												{t(
													`capabilityDetail.contactModes.${provider.contact_mode}`
												)}
											</Tag>
										</Descriptions.Item>
									</Descriptions>
									{provider.pricing_hint && (
										<Text type="secondary" style={{ fontSize: 12 }}>
											{provider.pricing_hint}
										</Text>
									)}
								</Card>
							</Col>
						))}
					</Row>
				)}
			</Spin>

			{nextPaginationKey && (
				<Button
					onClick={() => loadProviders(nextPaginationKey, false)}
					loading={providersLoading}
					block
					style={{ marginTop: 16 }}
				>
					{t("capabilityDetail.loadMoreProviders")}
				</Button>
			)}
		</div>
	);
}
