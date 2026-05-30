import React from "react";
import { useTranslation } from "react-i18next";
import { Button, Table, Empty, Loading } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { Title } from "../../components/Title";

const ReferenceInboxPage: React.FC = () => {
	const { t } = useTranslation("references");
	const [loading, setLoading] = React.useState(false);
	const [requests] = React.useState([]);

	React.useEffect(() => {
		// Fetch reference requests for the hub user
		const fetchRequests = async () => {
			setLoading(true);
			// TODO: Call API to list reference requests
			setLoading(false);
		};
		fetchRequests();
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
			<div style={{ marginBottom: 16 }}>
				<Link to="/">
					<Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button>
				</Link>
			</div>

			<Title level={2} style={{ marginBottom: 24 }}>
				{t("referenceRequests")}
			</Title>

			<Loading spinning={loading}>
				{requests.length === 0 ? (
					<Empty description={t("noRequests")} />
				) : (
					<Table
						columns={[
							{ dataIndex: "org_name", title: t("company") },
							{ dataIndex: "opening_title", title: t("role") },
							{ dataIndex: "kind", title: t("type") },
							{ dataIndex: "state", title: t("state") },
							{ dataIndex: "response_deadline", title: t("deadline") },
						]}
						dataSource={requests}
						rowKey="request_id"
					/>
				)}
			</Loading>
		</div>
	);
};

export default ReferenceInboxPage;
