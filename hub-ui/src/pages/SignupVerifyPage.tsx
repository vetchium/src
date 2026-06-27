import { Card, Typography, Alert, Grid, theme } from "antd";
import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SignupCompleteForm } from "../forms/SignupCompleteForm";

const { Title, Text } = Typography;

export function SignupVerifyPage() {
	const { t } = useTranslation("signup");
	const [searchParams] = useSearchParams();
	const signupToken = searchParams.get("token");
	const screens = Grid.useBreakpoint();
	const { token } = theme.useToken();

	// Scale card width to viewport via breakpoints — no hardcoded pixels.
	const cardWidth = screens.xl
		? "55vw"
		: screens.lg
			? "65vw"
			: screens.md
				? "80vw"
				: "95vw";

	if (!signupToken) {
		return (
			<Card style={{ width: cardWidth }}>
				<Alert
					description={t("invalidToken")}
					type="error"
					showIcon
					style={{ marginBottom: token.margin }}
				/>
				<div style={{ textAlign: "center" }}>
					<Text>
						<Link to="/signup">{t("signupLink")}</Link>
					</Text>
				</div>
			</Card>
		);
	}

	return (
		<Card style={{ width: cardWidth }}>
			<Title
				level={3}
				style={{ textAlign: "center", marginBottom: token.marginLG }}
			>
				{t("completeTitle")}
			</Title>

			<SignupCompleteForm signupToken={signupToken} />

			<div style={{ textAlign: "center", marginTop: token.margin }}>
				<Text>
					<Link to="/login">{t("loginLink")}</Link>
				</Text>
			</div>
		</Card>
	);
}
