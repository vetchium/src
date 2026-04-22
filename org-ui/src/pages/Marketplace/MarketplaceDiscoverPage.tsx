import { ArrowLeftOutlined, SearchOutlined } from "@ant-design/icons";
import {
	Button,
	Card,
	Col,
	Input,
	Row,
	Select,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type {
	ListingCard,
	MarketplaceCapability,
} from "vetchium-specs/org/marketplace";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

const { Title, Text, Paragraph } = Typography;

export function MarketplaceDiscoverPage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();

	const [listings, setListings] = useState<ListingCard[]>([]);
	const [capabilities, setCapabilities] = useState<MarketplaceCapability[]>([]);
	const [loading, setLoading] = useState(false);
	const [capabilityFilter, setCapabilityFilter] = useState<string>("");
	const [searchText, setSearchText] = useState<string>("");
	const [nextKey, setNextKey] = useState<string | undefined>();

	const loadCapabilities = useCallback(async () => {
		if (!sessionToken) return;
		try {
			const baseUrl = await getApiBaseUrl();
			const resp = await fetch(`${baseUrl}/org/marketplace/list-capabilities`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify({}),
			});
			if (resp.status === 200) {
				const data = await resp.json();
				setCapabilities(data.capabilities || []);
			}
		} catch {
			// ignore
		}
	}, [sessionToken]);

	const loadListings = useCallback(
		async (paginationKey?: string) => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const baseUrl = await getApiBaseUrl();
				const resp = await fetch(`${baseUrl}/org/marketplace/discover`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						...(capabilityFilter ? { capability_id: capabilityFilter } : {}),
						...(searchText ? { search_text: searchText } : {}),
						...(paginationKey ? { pagination_key: paginationKey } : {}),
						limit: 20,
					}),
				});
				if (resp.status === 200) {
					const data = await resp.json();
					if (paginationKey) {
						setListings((prev) => [...prev, ...(data.listings || [])]);
					} else {
						setListings(data.listings || []);
					}
					setNextKey(data.next_pagination_key);
				}
			} finally {
				setLoading(false);
			}
		},
		[sessionToken, capabilityFilter, searchText]
	);

	useEffect(() => {
		loadCapabilities();
	}, [loadCapabilities]);

	useEffect(() => {
		loadListings();
	}, [loadListings]);

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
				{t("discover.title")}
			</Title>

			<Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
				<Col xs={24} sm={12}>
					<Select
						allowClear
						placeholder={t("discover.filterByCapability")}
						style={{ width: "100%" }}
						onChange={(val) => setCapabilityFilter(val || "")}
						options={capabilities.map((c) => ({
							value: c.capability_id,
							label: c.display_name,
						}))}
					/>
				</Col>
				<Col xs={24} sm={12}>
					<Input
						prefix={<SearchOutlined />}
						placeholder={t("discover.searchPlaceholder")}
						allowClear
						onChange={(e) => setSearchText(e.target.value)}
					/>
				</Col>
			</Row>

			<Spin spinning={loading}>
				{listings.length === 0 && !loading ? (
					<Text type="secondary">{t("discover.noListings")}</Text>
				) : (
					<Row gutter={[24, 24]}>
						{listings.map((listing) => (
							<Col key={listing.listing_id} xs={24} sm={12} lg={8}>
								<Link
									to={`/marketplace/listings/${listing.org_domain}/${listing.listing_number}`}
									style={{ textDecoration: "none" }}
								>
									<Card
										hoverable
										title={
											<Space>
												{listing.headline}
												{listing.is_subscribed && (
													<Tag color="cyan">{t("status.subscribed")}</Tag>
												)}
											</Space>
										}
										extra={<Text type="secondary">{listing.org_domain}</Text>}
										style={{ height: "100%" }}
									>
										<Paragraph
											ellipsis={{ rows: 3 }}
											style={{ marginBottom: 12 }}
										>
											{listing.description}
										</Paragraph>
										<div>
											{listing.capability_ids.map((cap) => (
												<Tag key={cap} color="blue">
													{cap}
												</Tag>
											))}
										</div>
									</Card>
								</Link>
							</Col>
						))}
					</Row>
				)}
				{nextKey && (
					<div style={{ textAlign: "center", marginTop: 24 }}>
						<Button onClick={() => loadListings(nextKey)}>
							{t("discover.loadMore")}
						</Button>
					</div>
				)}
			</Spin>
		</div>
	);
}
