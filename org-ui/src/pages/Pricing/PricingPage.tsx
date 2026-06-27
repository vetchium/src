import { useEffect, useState } from "react";
import { Select, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Region, GetRegionsResponse } from "vetchium-specs/global/global";
import { getApiBaseUrl } from "../../config";
import { OrgPlanPricing } from "../../components/OrgPlanPricing";

const { Title, Text } = Typography;

// Public, logged-out plans & pricing page. Region is user-selected here (no
// authenticated home region); prices are display-only frontend config.
export function PricingPage() {
	const { t } = useTranslation("plan");
	const [regions, setRegions] = useState<Region[]>([]);
	const [region, setRegion] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchRegions = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const response = await fetch(`${apiBaseUrl}/global/get-regions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				});
				if (response.status === 200) {
					const data = (await response.json()) as GetRegionsResponse;
					const list: Region[] = data.regions || [];
					setRegions(list);
					const first = list[0];
					if (first) setRegion(first.region_code);
				}
			} catch (err) {
				console.error("Failed to fetch regions:", err);
			} finally {
				setLoading(false);
			}
		};
		fetchRegions();
	}, []);

	return (
		<div
			style={{
				width: "100%",
				maxWidth: 1200,
				padding: "24px 16px",
				alignSelf: "flex-start",
			}}
		>
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: 16,
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<Title level={2} style={{ margin: 0 }}>
					{t("pricing.pageTitle")}
				</Title>
				<Select
					value={region}
					onChange={setRegion}
					loading={loading}
					style={{ minWidth: 220 }}
					placeholder={t("pricing.regionLabel")}
					options={regions.map((r) => ({
						value: r.region_code,
						label: r.region_name,
					}))}
				/>
			</div>

			<Text type="secondary">{t("pricing.pageSubtitle")}</Text>

			<div style={{ marginTop: 24 }}>
				<Spin spinning={loading}>
					{region && <OrgPlanPricing regionCode={region} />}
				</Spin>
			</div>

			<div style={{ marginTop: 24 }}>
				<Link to="/login">{t("pricing.backToLogin")}</Link>
			</div>
		</div>
	);
}
