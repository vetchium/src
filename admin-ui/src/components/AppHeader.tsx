import { Layout, Space, Switch, Select } from "antd";
import { BulbOutlined, BulbFilled, GlobalOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../hooks/useTheme";
import {
	SUPPORTED_LANGUAGES,
	setStoredLanguage,
	type SupportedLanguage,
} from "../i18n";
import { useAuth } from "../hooks/useAuth";
import { getApiBaseUrl } from "../config";

const { Header } = Layout;

export function AppHeader() {
	const { t, i18n } = useTranslation("common");
	const { theme, toggleTheme } = useTheme();
	const { authState, sessionToken } = useAuth();

	const handleLanguageChange = async (value: SupportedLanguage) => {
		setStoredLanguage(value);
		i18n.changeLanguage(value);

		// If authenticated, sync to server
		if (authState === "authenticated" && sessionToken) {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				await fetch(`${apiBaseUrl}/admin/preferences`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						preferred_language: value,
					}),
				});
			} catch (err) {
				console.warn("Failed to sync language preference to server:", err);
			}
		}
	};

	const languageOptions = SUPPORTED_LANGUAGES.map((lang) => ({
		value: lang,
		label: t(`language.${lang}`),
	}));

	return (
		<Header
			style={{
				display: "flex",
				justifyContent: "flex-end",
				alignItems: "center",
				background: "transparent",
				padding: "0 24px",
			}}
		>
			<Space size="middle">
				<Space>
					<GlobalOutlined />
					<Select
						value={i18n.language as SupportedLanguage}
						onChange={handleLanguageChange}
						options={languageOptions}
						style={{ width: 120 }}
						size="small"
					/>
				</Space>
				<Space>
					{theme === "light" ? <BulbOutlined /> : <BulbFilled />}
					<Switch
						checked={theme === "dark"}
						onChange={toggleTheme}
						checkedChildren={t("theme.dark")}
						unCheckedChildren={t("theme.light")}
					/>
				</Space>
			</Space>
		</Header>
	);
}
