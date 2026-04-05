import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

const { Title, Paragraph } = Typography;

export function MarketplacePage() {
	const { t } = useTranslation("marketplace");
	const navigate = useNavigate();

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

			<Row gutter={[24, 24]}>
				<Col xs={24} md={8}>
					<Card
						hoverable
						style={{ height: "100%", cursor: "pointer" }}
						onClick={() => navigate("/marketplace/capabilities")}
					>
						<Title level={4}>{t("launcher.exploreTitle")}</Title>
						<Paragraph type="secondary">
							{t("launcher.exploreSubtitle")}
						</Paragraph>
						<Button type="primary" block>
							{t("launcher.exploreAction")}
						</Button>
					</Card>
				</Col>
				<Col xs={24} md={8}>
					<Card
						hoverable
						style={{ height: "100%", cursor: "pointer" }}
						onClick={() => navigate("/marketplace/provide")}
					>
						<Title level={4}>{t("launcher.provideTitle")}</Title>
						<Paragraph type="secondary">
							{t("launcher.provideSubtitle")}
						</Paragraph>
						<Button type="default" block>
							{t("launcher.provideAction")}
						</Button>
					</Card>
				</Col>
				<Col xs={24} md={8}>
					<Card
						hoverable
						style={{ height: "100%", cursor: "pointer" }}
						onClick={() => navigate("/marketplace/purchases")}
					>
						<Title level={4}>{t("launcher.purchasesTitle")}</Title>
						<Paragraph type="secondary">
							{t("launcher.purchasesSubtitle")}
						</Paragraph>
						<Button type="default" block>
							{t("launcher.purchasesAction")}
						</Button>
					</Card>
				</Col>
			</Row>
		</div>
	);
}
