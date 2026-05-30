import React from "react";
import { Button, Card, Table } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeftOutlined } from "@ant-design/icons";

export const HiringDiscoveryPage: React.FC = () => {
	const { t } = useTranslation("hiring");

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

			<h2 style={{ marginBottom: 24 }}>Hiring Discovery (TODO)</h2>

			<Card>
				<p>Search and browse job opportunities from your network</p>
				<Table columns={[]} dataSource={[]} />
			</Card>
		</div>
	);
};
