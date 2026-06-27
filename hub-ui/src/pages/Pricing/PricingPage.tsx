import { useEffect, useState } from "react";
import { Select, Spin, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { Region } from "vetchium-specs/global/global";
import * as api from "../../lib/api-client";
import { HubPlanPricing } from "../../components/HubPlanPricing";

const { Title, Text } = Typography;

// Public, logged-out plans & pricing page. Region is user-selected here (no
// authenticated home region); prices are display-only frontend config.
export const PricingPage: React.FC = () => {
	const { t } = useTranslation("plan");
	const [regions, setRegions] = useState<Region[]>([]);
	const [region, setRegion] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const loadRegions = async () => {
			try {
				const resp = await api.getRegions();
				if (resp.status === 200 && resp.data) {
					setRegions(resp.data);
					if (resp.data.length > 0) setRegion(resp.data[0].region_code);
				}
			} catch {
				// Leave region unset; the page renders the selector with no options.
			} finally {
				setLoading(false);
			}
		};
		loadRegions();
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
					{t("pageTitle")}
				</Title>
				<Select
					value={region}
					onChange={setRegion}
					loading={loading}
					style={{ minWidth: 220 }}
					placeholder={t("regionLabel")}
					options={regions.map((r) => ({
						value: r.region_code,
						label: r.region_name,
					}))}
				/>
			</div>

			<Text type="secondary">{t("pageSubtitle")}</Text>

			<div style={{ marginTop: 24 }}>
				<Spin spinning={loading}>
					{region && <HubPlanPricing regionCode={region} />}
				</Spin>
			</div>

			<div style={{ marginTop: 24 }}>
				<Link to="/login">{t("backToLogin")}</Link>
			</div>
		</div>
	);
};
