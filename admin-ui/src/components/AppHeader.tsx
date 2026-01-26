import { Layout, Space, Switch, Select, Dropdown, Avatar, type MenuProps } from "antd";
import {
	BulbOutlined,
	BulbFilled,
	GlobalOutlined,
	UserOutlined,
	LogoutOutlined,
	LockOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../hooks/useTheme";
import { useLanguage } from "../hooks/useLanguage";
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
	const { authState, sessionToken, logout } = useAuth();
	const { languages, loading: languagesLoading } = useLanguage();

	const navigate = useNavigate();

	const handleLanguageChange = async (value: SupportedLanguage) => {
		setStoredLanguage(value);
		i18n.changeLanguage(value);

		// If authenticated, sync to server
		if (authState === "authenticated" && sessionToken) {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				await fetch(`${apiBaseUrl}/admin/set-language`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({
						language: value,
					}),
				});
			} catch (err) {
				console.warn("Failed to sync language preference to server:", err);
			}
		}
	};

	// Use server-provided languages if available, fallback to hardcoded list
	const languageOptions =
		languages.length > 0
			? languages.map((lang) => ({
				value: lang.language_code,
				label: lang.native_name,
			}))
			: SUPPORTED_LANGUAGES.map((lang) => ({
				value: lang,
				label: t(`language.${lang}`),
			}));

	const userMenuItems: MenuProps["items"] = [
		{
			key: "change-password",
			icon: <LockOutlined />,
			label: t("header.changePassword", "Change Password"),
			onClick: () => navigate("/change-password"),
		},
		{
			type: "divider",
		},
		{
			key: "logout",
			icon: <LogoutOutlined />,
			label: t("header.logout", "Logout"),
			onClick: () => logout(),
		},
	];

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
						loading={languagesLoading}
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
				{authState === "authenticated" && (
					<Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
						<Avatar
							icon={<UserOutlined />}
							style={{
								cursor: "pointer",
								backgroundColor: theme === "dark" ? "#1890ff" : "#1890ff",
							}}
						/>
					</Dropdown>
				)}
			</Space>
		</Header>
	);
}
