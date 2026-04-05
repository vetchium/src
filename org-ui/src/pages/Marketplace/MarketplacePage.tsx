import { ArrowLeftOutlined, ShopOutlined, RocketOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useMyInfo } from "../../hooks/useMyInfo";

const { Title, Paragraph } = Typography;

export function MarketplacePage() {
	const { t } = useTranslation("marketplace");
	const navigate = useNavigate();
	const { sessionToken } = useAuth();
	const { data: myInfo } = useMyInfo(sessionToken);

	const hasProviderHubAccess =
		myInfo?.roles.includes("org:superadmin") ||
		myInfo?.roles.includes("org:manage_marketplace") ||
		false;

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
				<Col xs={24} md={hasProviderHubAccess ? 8 : 12}>
					<Card
						hoverable
						style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
						onClick={() => navigate("/marketplace/capabilities")}
					>
						<ShopOutlined style={{ fontSize: 48, color: "#1890ff", marginBottom: 16 }} />
						<Title level={4}>{t("launcher.exploreTitle")}</Title>
						<Paragraph type="secondary" style={{ minHeight: 44 }}>
							{t("launcher.exploreSubtitle")}
						</Paragraph>
						<Button type="primary" block>
							{t("launcher.exploreAction")}
						</Button>
					</Card>
				</Col>
				{hasProviderHubAccess && (
					<Col xs={24} md={8}>
						<Card
							hoverable
							style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
							onClick={() => navigate("/marketplace/provide")}
						>
							<RocketOutlined style={{ fontSize: 48, color: "#fa541c", marginBottom: 16 }} />
							<Title level={4}>{t("launcher.provideTitle")}</Title>
							<Paragraph type="secondary" style={{ minHeight: 44 }}>
								{t("launcher.provideSubtitle")}
							</Paragraph>
							<Button type="default" block>
								{t("launcher.provideAction")}
							</Button>
						</Card>
					</Col>
				)}
				<Col xs={24} md={hasProviderHubAccess ? 8 : 12}>
					<Card
						hoverable
						style={{ height: "100%", cursor: "pointer", textAlign: "center" }}
						onClick={() => navigate("/marketplace/purchases")}
					>
						<ShoppingCartOutlined style={{ fontSize: 48, color: "#52c41a", marginBottom: 16 }} />
						<Title level={4}>{t("launcher.purchasesTitle")}</Title>
						<Paragraph type="secondary" style={{ minHeight: 44 }}>
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
