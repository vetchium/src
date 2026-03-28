import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Tabs, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";
import { MarketplaceBrowsePage } from "./MarketplaceBrowsePage";
import { MarketplaceCapabilityPage } from "./MarketplaceCapabilityPage";
import { MarketplaceListingsPage } from "./MarketplaceListingsPage";
import { useCallback, useEffect, useState } from "react";
import { getApiBaseUrl } from "../../config";
import type { OrgCapability } from "vetchium-specs/org/marketplace";

const { Title } = Typography;

export function MarketplacePage() {
	const { t } = useTranslation("marketplace");
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const hasProviderAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

	const [capability, setCapability] = useState<OrgCapability | null>(null);

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
		}
	}, [sessionToken, hasProviderAccess]);

	useEffect(() => {
		loadCapability();
	}, [loadCapability]);

	const hasActiveCapability = capability?.status === "active";

	const providerTabItems = [
		{
			key: "capability",
			label: t("capability.title"),
			children: <MarketplaceCapabilityPage />,
		},
		{
			key: "listings",
			label: t("listings.title"),
			children: <MarketplaceListingsPage hasCapability={hasActiveCapability} />,
		},
	];

	const allTabItems = [
		...(hasProviderAccess
			? [
					{
						key: "provider",
						label: t("providerSection"),
						children: (
							<Tabs
								defaultActiveKey="capability"
								items={providerTabItems}
								style={{ marginTop: 8 }}
							/>
						),
					},
				]
			: []),
		{
			key: "browse",
			label: t("browseSection"),
			children: <MarketplaceBrowsePage />,
		},
	];

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

			<Tabs
				defaultActiveKey={hasProviderAccess ? "provider" : "browse"}
				items={allTabItems}
			/>
		</div>
	);
}
