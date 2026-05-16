import { Card, Typography } from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface AboutSectionProps {
	longBio?: string;
	isOwner: boolean;
}

const { Paragraph, Text } = Typography;

export function AboutSection({ longBio, isOwner }: AboutSectionProps) {
	const { t } = useTranslation("profile");

	if (!longBio) {
		if (!isOwner) {
			return null;
		}
		return (
			<Card title={t("publicProfile.about")}>
				<Link to="/settings/profile">
					<Text type="secondary">{t("publicProfile.addAbout")}</Text>
				</Link>
			</Card>
		);
	}

	return (
		<Card title={t("publicProfile.about")}>
			<Paragraph style={{ whiteSpace: "pre-line", margin: 0 }}>
				{longBio}
			</Paragraph>
		</Card>
	);
}
