import { UserOutlined } from "@ant-design/icons";
import { Avatar, Image } from "antd";
import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../../config";
import { useAuth } from "../../hooks/useAuth";

interface ProfileAvatarProps {
	handle: string;
	hasPicture: boolean;
	size: number;
	alt?: string;
	// When true, clicking the picture opens a full-size zoomable lightbox.
	preview?: boolean;
}

// Profile pictures are served by an authenticated endpoint
// (GET /hub/profile-picture/{handle}). A plain <img src> cannot send the
// Authorization header (and would hit the UI origin, not the API), so we fetch
// the bytes with the bearer token and render the resulting object URL — the
// same pattern used for the authenticated offer-letter download.
export function ProfileAvatar({
	handle,
	hasPicture,
	size,
	alt,
	preview = false,
}: ProfileAvatarProps) {
	const { sessionToken } = useAuth();
	// Tag the object URL with the handle it belongs to so a stale image is never
	// shown after the handle prop changes.
	const [pic, setPic] = useState<{ handle: string; url: string } | null>(null);

	useEffect(() => {
		if (!hasPicture || !handle || !sessionToken) return;

		let cancelled = false;
		let createdUrl: string | null = null;

		const load = async () => {
			try {
				const apiBaseUrl = await getApiBaseUrl();
				const res = await fetch(`${apiBaseUrl}/hub/profile-picture/${handle}`, {
					headers: { Authorization: `Bearer ${sessionToken}` },
				});
				if (!res.ok || cancelled) return;
				const blob = await res.blob();
				if (cancelled) return;
				createdUrl = URL.createObjectURL(blob);
				setPic({ handle, url: createdUrl });
			} catch {
				// fall back to the placeholder avatar
			}
		};

		load();

		return () => {
			cancelled = true;
			if (createdUrl) URL.revokeObjectURL(createdUrl);
		};
	}, [handle, hasPicture, sessionToken]);

	if (hasPicture && pic && pic.handle === handle) {
		if (preview) {
			return (
				<Image
					src={pic.url}
					alt={alt ?? handle}
					width={size}
					height={size}
					style={{ borderRadius: "50%", objectFit: "cover" }}
				/>
			);
		}
		return (
			<img
				src={pic.url}
				alt={alt ?? handle}
				style={{
					width: size,
					height: size,
					borderRadius: "50%",
					objectFit: "cover",
				}}
			/>
		);
	}

	return <Avatar size={size} icon={<UserOutlined />} />;
}
