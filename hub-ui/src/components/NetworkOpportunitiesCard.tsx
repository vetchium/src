import React, { useEffect, useState } from "react";
import {
	Card,
	Empty,
	List,
	Spin,
	Typography,
	Button,
	Tooltip,
	Space,
} from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRightOutlined } from "@ant-design/icons";
import type { NetworkOpportunity } from "vetchium-specs/hub/discovery";
import { getApiBaseUrl } from "../config";

const { Text, Title } = Typography;

interface NetworkOpportunitiesCardProps {
	sessionToken: string | null;
}

export const NetworkOpportunitiesCard: React.FC<
	NetworkOpportunitiesCardProps
> = ({ sessionToken }) => {
	const { t } = useTranslation("hiring");
	const [loading, setLoading] = useState(false);
	const [opportunities, setOpportunities] = useState<NetworkOpportunity[]>([]);

	useEffect(() => {
		const fetchOpportunities = async () => {
			if (!sessionToken) return;
			setLoading(true);
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(
					`${apiBaseUrl}/hub/list-network-opportunities`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${sessionToken}`,
						},
						body: JSON.stringify({ limit: 5 }),
					}
				);
				if (res.status === 200) {
					const data = (await res.json()) as {
						opportunities: NetworkOpportunity[];
					};
					setOpportunities(data.opportunities.slice(0, 5));
				}
			} catch {
				// silently fail
			} finally {
				setLoading(false);
			}
		};
		fetchOpportunities();
	}, [sessionToken]);

	if (loading) {
		return <Spin />;
	}

	if (opportunities.length === 0) {
		return <Empty description={t("noNetworkOpportunities")} />;
	}

	return (
		<List
			dataSource={opportunities}
			renderItem={(opp) => (
				<Card
					size="small"
					style={{
						marginBottom: 8,
						cursor: "pointer",
					}}
					hoverable
				>
					<Link
						to={`/org/${opp.org_domain}/openings/${opp.opening_number}`}
						style={{ textDecoration: "none", color: "inherit" }}
					>
						<Space orientation="vertical" style={{ width: "100%" }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "flex-start",
								}}
							>
								<div style={{ flex: 1 }}>
									<Title level={5} style={{ margin: 0, marginBottom: 4 }}>
										{opp.opening_title}
									</Title>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{opp.org_name}
									</Text>
								</div>
								<ArrowRightOutlined style={{ marginLeft: 8 }} />
							</div>
							<Text type="secondary" style={{ fontSize: 12 }}>
								{opp.colleague_count} {t("colleagues")} {t("workingHere")}
							</Text>
						</Space>
					</Link>
				</Card>
			)}
			size="small"
			header={
				<div
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<Title level={5} style={{ margin: 0 }}>
						{t("networkOpportunities")}
					</Title>
					<Tooltip title={t("seenAtOrgsInYourNetwork")}>
						<Button type="text" size="small">
							?
						</Button>
					</Tooltip>
				</div>
			}
		/>
	);
};
