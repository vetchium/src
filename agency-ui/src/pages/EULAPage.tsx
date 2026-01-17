import { Card, Typography } from "antd";

const { Title, Paragraph } = Typography;

export function EULAPage() {
	return (
		<Card style={{ maxWidth: 800, margin: "24px auto" }}>
			<Title level={2}>End User License Agreement</Title>
			<Title level={3}>Last Updated: January 2026</Title>

			<Paragraph>
				<strong>Placeholder EULA</strong>
			</Paragraph>

			<Paragraph>
				This is a placeholder End User License Agreement for Vetchium.
			</Paragraph>

			<Title level={4}>1. Acceptance of Terms</Title>
			<Paragraph>
				By using Vetchium's services, you agree to be bound by this End User
				License Agreement ("EULA"). If you do not agree to these terms, you may
				not use our services.
			</Paragraph>

			<Title level={4}>2. Service Description</Title>
			<Paragraph>
				Vetchium provides a multi-region job search and hiring platform that
				connects professionals with employers and agencies.
			</Paragraph>

			<Title level={4}>3. Account Responsibilities</Title>
			<Paragraph>You are responsible for:</Paragraph>
			<ul>
				<li>Maintaining the confidentiality of your account credentials</li>
				<li>All activities that occur under your account</li>
				<li>Ensuring the accuracy of information you provide</li>
				<li>Complying with all applicable laws and regulations</li>
			</ul>

			<Title level={4}>4. Data Privacy</Title>
			<Paragraph>
				Your data is stored in the region you select during signup. We are
				committed to protecting your privacy and handling your data in
				accordance with applicable data protection regulations including GDPR,
				CCPA, and local data protection laws.
			</Paragraph>

			<Title level={4}>5. Domain Verification</Title>
			<Paragraph>
				For employer accounts, you must verify domain ownership through DNS
				verification. You represent that you have the authority to manage DNS
				records for the domain you are registering.
			</Paragraph>

			<Title level={4}>6. Prohibited Activities</Title>
			<Paragraph>You may not:</Paragraph>
			<ul>
				<li>Use the service for any illegal purposes</li>
				<li>Impersonate others or provide false information</li>
				<li>Interfere with the proper functioning of the service</li>
				<li>Attempt unauthorized access to our systems</li>
				<li>Scrape or harvest data without authorization</li>
			</ul>

			<Title level={4}>7. Termination</Title>
			<Paragraph>
				We reserve the right to suspend or terminate your account if you violate
				this EULA or engage in activities that harm the service or other users.
			</Paragraph>

			<Title level={4}>8. Limitation of Liability</Title>
			<Paragraph>
				Vetchium is provided "as is" without warranties of any kind. We are not
				liable for any indirect, incidental, or consequential damages arising
				from your use of the service.
			</Paragraph>

			<Title level={4}>9. Changes to Terms</Title>
			<Paragraph>
				We may update this EULA from time to time. Continued use of the service
				after changes constitutes acceptance of the updated terms.
			</Paragraph>

			<Title level={4}>10. Contact</Title>
			<Paragraph>
				For questions about this EULA, please contact us at legal@vetchium.com
			</Paragraph>

			<Paragraph type="secondary" style={{ marginTop: 32 }}>
				<em>Note: This is a placeholder EULA for development purposes only.</em>
			</Paragraph>
		</Card>
	);
}
