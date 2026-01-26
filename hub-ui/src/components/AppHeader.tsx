import {
	Layout,
	Space,
	Switch,
	Select,
	Dropdown,
	Avatar,
	type MenuProps,
	theme,
} from "antd";
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
	const { theme: themeMode, toggleTheme } = useTheme();
	const { isAuthenticated, sessionToken, logout } = useAuth();
	const { languages, loading: languagesLoading } = useLanguage();

	const navigate = useNavigate();

	const handleLanguageChange = async (value: SupportedLanguage) => {
		setStoredLanguage(value);
		i18n.changeLanguage(value);

		// Sync to server if authenticated
		if (isAuthenticated && sessionToken) {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				await fetch(`${apiBaseUrl}/hub/set-language`, {
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
				console.warn("Failed to sync language to server:", err);
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

	const { token } = theme.useToken();

	return (
		<Header
			style={{
				display: "flex",
				justifyContent: "flex-end",
				alignItems: "center",
				background: token.colorPrimary,
				padding: "0 24px",
				transition: "background 0.2s",
			}}
		>
			<Space size="middle">
				<Space>
					<GlobalOutlined style={{ color: "#fff" }} />
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
					{themeMode === "light" ? (
						<BulbOutlined style={{ color: "#fff" }} />
					) : (
						<BulbFilled style={{ color: "#fff" }} />
					)}
					<Switch
						checked={themeMode === "dark"}
						onChange={toggleTheme}
						checkedChildren={t("theme.dark")}
						unCheckedChildren={t("theme.light")}
					/>
				</Space>
				{isAuthenticated && (
					<Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
						<Avatar
							icon={<UserOutlined />}
							style={{
								cursor: "pointer",
								backgroundColor: "#fff",
								color: token.colorPrimary,
							}}
						/>
					</Dropdown>
				)}
			</Space>
		</Header>
	);
}
