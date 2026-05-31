import React, { useCallback, useEffect, useState } from "react";
import {
	Button,
	Card,
	Col,
	Descriptions,
	Row,
	Space,
	Spin,
	Tag,
	Typography,
} from "antd";
import {
	ArrowLeftOutlined,
	BankOutlined,
	CheckCircleFilled,
	EnvironmentOutlined,
	UserOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
	HubGetOpeningRequest,
	HubOpeningDetail,
} from "vetchium-specs/hub/hiring-discovery";
import type {
	EmploymentType,
	WorkLocationType,
} from "vetchium-specs/org/openings";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";
import { formatDate } from "../../utils/dateFormat";

const { Title, Paragraph, Text } = Typography;

const employmentTypeColor: Record<EmploymentType, string> = {
	full_time: "blue",
	part_time: "cyan",
	contract: "orange",
	internship: "purple",
};

const workLocationColor: Record<WorkLocationType, string> = {
	remote: "green",
	on_site: "default",
	hybrid: "geekblue",
};

function titleCase(v: string) {
	return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const OpeningDetailPage: React.FC = () => {
	const { t, i18n } = useTranslation("openings");
	const { sessionToken } = useAuth();
	const navigate = useNavigate();
	const { orgDomain, openingNumber } = useParams<{
		orgDomain: string;
		openingNumber: string;
	}>();
	const [opening, setOpening] = useState<HubOpeningDetail | null>(null);
	const [loading, setLoading] = useState(false);

	const fetchOpening = useCallback(async () => {
		if (!sessionToken || !orgDomain || !openingNumber) return;
		setLoading(true);
		try {
			const apiBaseUrl = await getApiBaseUrl();
			const req: HubGetOpeningRequest = {
				org_domain: orgDomain,
				opening_number: parseInt(openingNumber, 10),
			};
			const res = await fetch(`${apiBaseUrl}/hub/get-opening`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${sessionToken}`,
				},
				body: JSON.stringify(req),
			});
			if (res.status === 200) {
				const data: HubOpeningDetail = await res.json();
				setOpening(data);
			}
		} finally {
			setLoading(false);
		}
	}, [sessionToken, orgDomain, openingNumber]);

	useEffect(() => {
		fetchOpening();
	}, [fetchOpening]);

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
				<Link to="/openings">
					<Button icon={<ArrowLeftOutlined />}>{t("backToOpenings")}</Button>
				</Link>
			</div>

			<Spin spinning={loading}>
				{opening && (
					<>
						{/* Header */}
						<div style={{ marginBottom: 24 }}>
							<Title level={2} style={{ margin: 0, marginBottom: 8 }}>
								{opening.title}
							</Title>
							<Space size={6} align="center">
								<BankOutlined style={{ color: "#8c8c8c" }} />
								<Text type="secondary" style={{ fontSize: 16 }}>
									{orgDomain}
								</Text>
							</Space>
						</div>

						<Row gutter={[24, 24]}>
							{/* Main column */}
							<Col xs={24} md={16}>
								<Card title={t("description")} style={{ marginBottom: 16 }}>
									<Paragraph
										style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
									>
										{opening.description}
									</Paragraph>
								</Card>

								{(opening.min_yoe !== undefined ||
									opening.max_yoe !== undefined ||
									opening.min_education_level) && (
									<Card title={t("requirements")}>
										<Descriptions column={1} size="small">
											{(opening.min_yoe !== undefined ||
												opening.max_yoe !== undefined) && (
												<Descriptions.Item label={t("experience")}>
													{opening.min_yoe !== undefined &&
													opening.max_yoe !== undefined
														? `${opening.min_yoe} – ${opening.max_yoe} ${t("years")}`
														: opening.min_yoe !== undefined
															? `${opening.min_yoe}+ ${t("years")}`
															: `≤ ${opening.max_yoe} ${t("years")}`}
												</Descriptions.Item>
											)}
											{opening.min_education_level && (
												<Descriptions.Item label={t("minEducation")}>
													{titleCase(opening.min_education_level)}
												</Descriptions.Item>
											)}
										</Descriptions>
									</Card>
								)}
							</Col>

							{/* Sidebar */}
							<Col xs={24} md={8}>
								{/* Apply CTA */}
								<Card style={{ marginBottom: 16 }}>
									{opening.viewer_has_applied ? (
										<div style={{ textAlign: "center", padding: "8px 0" }}>
											<CheckCircleFilled
												style={{
													fontSize: 36,
													color: "#52c41a",
													display: "block",
													marginBottom: 8,
												}}
											/>
											<Text strong style={{ fontSize: 16, color: "#52c41a" }}>
												{t("alreadyApplied")}
											</Text>
										</div>
									) : (
										<Button
											type="primary"
											size="large"
											block
											onClick={() =>
												navigate(
													`/org/${orgDomain}/openings/${openingNumber}/apply`
												)
											}
										>
											{t("applyNow")}
										</Button>
									)}
									{opening.viewer_can_refer && (
										<Button
											block
											icon={<UserOutlined />}
											style={{ marginTop: 8 }}
											onClick={() =>
												navigate(
													`/my-employer/${orgDomain}/openings/${openingNumber}/refer`
												)
											}
										>
											{t("referColleague")}
										</Button>
									)}
								</Card>

								{/* Job details */}
								<Card title={t("details")} style={{ marginBottom: 16 }}>
									<Descriptions column={1} size="small">
										<Descriptions.Item label={t("employmentType")}>
											<Tag color={employmentTypeColor[opening.employment_type]}>
												{titleCase(opening.employment_type)}
											</Tag>
										</Descriptions.Item>
										{opening.salary && (
											<Descriptions.Item label={t("salary")}>
												{opening.salary.currency}{" "}
												{opening.salary.min_amount.toLocaleString(
													i18n.language
												)}
												{" – "}
												{opening.salary.max_amount.toLocaleString(
													i18n.language
												)}
											</Descriptions.Item>
										)}
										{opening.first_published_at && (
											<Descriptions.Item label={t("posted")}>
												{formatDate(opening.first_published_at, i18n.language)}
											</Descriptions.Item>
										)}
									</Descriptions>
								</Card>

								{/* Tags */}
								{(opening.tags?.length ?? 0) > 0 && (
									<Card title={t("tags")} style={{ marginBottom: 16 }}>
										<Space size={[6, 6]} wrap>
											{opening.tags.map((tag) => (
												<Tag key={tag.tag_id} color="processing">
													{tag.display_name}
												</Tag>
											))}
										</Space>
									</Card>
								)}

								{/* Location: work location type + office addresses */}
								<Card
									title={
										<Space>
											<EnvironmentOutlined />
											{t("locations")}
										</Space>
									}
									style={{ marginBottom: 16 }}
								>
									<Tag
										color={workLocationColor[opening.work_location_type]}
										style={{
											marginBottom:
												(opening.addresses?.length ?? 0) > 0 ? 10 : 0,
										}}
									>
										{titleCase(opening.work_location_type)}
									</Tag>
									{opening.addresses?.map((addr) => (
										<div key={addr.address_id} style={{ marginTop: 4 }}>
											<Text strong>{addr.city}</Text>
											{addr.state && <Text>, {addr.state}</Text>}
											<Text type="secondary"> · {addr.country}</Text>
										</div>
									))}
								</Card>
							</Col>
						</Row>
					</>
				)}
			</Spin>
		</div>
	);
};
