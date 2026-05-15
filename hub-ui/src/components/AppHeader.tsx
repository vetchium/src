import {
	Layout,
	Space,
	Switch,
	Select,
	Dropdown,
	Avatar,
	Typography,
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
	MailOutlined,
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
const { Text } = Typography;

export function AppHeader() {
	const { t, i18n } = useTranslation("common");
	const { theme: themeMode, toggleTheme } = useTheme();
	const { isAuthenticated, sessionToken, logout } = useAuth();
	const { languages, loading: languagesLoading } = useLanguage();

	const navigate = useNavigate();

	const handleLanguageChange = async (value: SupportedLanguage) => {
		setStoredLanguage(value);
		i18n.changeLanguage(value);

		if (isAuthenticated && sessionToken) {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				await fetch(`${apiBaseUrl}/hub/set-language`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${sessionToken}`,
					},
					body: JSON.stringify({ language: value }),
				});
			} catch (err) {
				console.warn("Failed to sync language to server:", err);
			}
		}
	};

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
			key: "change-email",
			icon: <MailOutlined />,
			label: t("header.changeEmail", "Change Email"),
			onClick: () => navigate("/change-email"),
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
				justifyContent: "space-between",
				alignItems: "center",
				background: token.colorPrimary,
				padding: "0 24px",
				transition: "background 0.2s",
			}}
		>
			{/* Brand */}
			<Text
				strong
				style={{
					color: "#fff",
					fontSize: 16,
					letterSpacing: 0.3,
					cursor: "pointer",
				}}
				onClick={() => navigate("/")}
			>
				{t("appName")}
			</Text>

			{/* Controls */}
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
