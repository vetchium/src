import { Card, Tag, Text, Tooltip } from "antd";
import { SafetyCertificateOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PublicEmployerStint } from "vetchium-specs/hub/work-emails";

interface WorkHistorySectionProps {
	stints: PublicEmployerStint[];
}

export function WorkHistorySection({ stints }: WorkHistorySectionProps) {
	const { t } = useTranslation("profile");

	const sortedStints = [...stints].sort((a, b) => {
		if (a.is_current && !b.is_current) return -1;
		if (!a.is_current && b.is_current) return 1;
		return (b.end_year ?? 0) - (a.end_year ?? 0);
	});

	return (
		<Card title={t("publicProfile.verifiedWorkHistory")}>
			{sortedStints.length === 0 ? (
				<Text type="secondary">{t("publicProfile.noVerifiedEmployers")}</Text>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					{sortedStints.map((stint) => (
						<div
							key={stint.domain}
							style={{ display: "flex", alignItems: "center", gap: 12 }}
						>
							<Tooltip title={t("publicProfile.verifiedViaWorkEmail")}>
								<SafetyCertificateOutlined
									style={{ color: "#52c41a", fontSize: 16 }}
								/>
							</Tooltip>
							<Text strong>{stint.domain}</Text>
							{stint.is_current && (
								<Tag color="green">{t("publicProfile.current")}</Tag>
							)}
							<Text type="secondary">
								{stint.start_year}
								{" – "}
								{stint.is_current ? t("publicProfile.present") : stint.end_year}
							</Text>
						</div>
					))}
				</div>
			)}
		</Card>
	);
}
