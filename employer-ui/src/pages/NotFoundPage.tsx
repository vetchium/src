import { Button, Result } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export function NotFoundPage() {
	const { t } = useTranslation("common");
	const navigate = useNavigate();

	return (
		<Result
			status="404"
			title="404"
			subTitle={t("errors.pageNotFound")}
			extra={
				<Button type="primary" onClick={() => navigate("/")}>
					{t("action.backHome")}
				</Button>
			}
		/>
	);
}
