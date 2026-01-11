import { Card, Typography, Result, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useSearchParams, Link } from "react-router-dom";
import { SignupCompleteForm } from "../forms/SignupCompleteForm";

const { Title } = Typography;

export function SignupCompletePage() {
	const { t } = useTranslation("auth");
	const [searchParams] = useSearchParams();
	const token = searchParams.get("token");

	if (!token) {
		return (
			<Card style={{ width: 400, maxWidth: "90vw" }}>
				<Result
					status="error"
					title={t("signupComplete.noToken")}
					subTitle={t("signupComplete.noTokenSubtitle")}
					extra={
						<Link to="/signup">
							<Button type="primary">{t("signupComplete.signupAgain")}</Button>
						</Link>
					}
				/>
			</Card>
		);
	}

	return (
		<Card style={{ width: 400, maxWidth: "90vw" }}>
			<Title level={2} style={{ textAlign: "center", marginBottom: 24 }}>
				{t("signupComplete.title")}
			</Title>
			<SignupCompleteForm signupToken={token} />
		</Card>
	);
}
