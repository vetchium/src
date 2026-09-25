import { Avatar, theme } from "antd";
import { usePreferences } from "../../app/PreferencesContext";

const graphemes = new Intl.Segmenter();

// A user-perceived first character, so an emoji or a base letter with
// combining marks is never cut in half the way String.slice would.
function initial(displayName: string, language: string): string {
  const first = graphemes.segment(displayName.trim())[Symbol.iterator]().next();
  return first.done ? "" : first.value.segment.toLocaleUpperCase(language);
}

/** The profile picture, or the display name's initial on a tinted background
 * when there is none — no plan entitlement, nothing uploaded, or the image
 * failed to load. */
export function ProfileAvatar({
  displayName,
  src,
  size,
  alt,
}: {
  displayName: string;
  src?: string;
  size: number;
  alt?: string;
}) {
  const { token } = theme.useToken();
  const { language } = usePreferences();
  return (
    <Avatar
      size={size}
      src={src}
      alt={alt}
      // Ant Design fixes a letter's font size at 18px whatever the avatar
      // size, which looks lost in a large avatar.
      style={{
        background: token.colorPrimaryBg,
        color: token.colorPrimary,
        fontSize: size / 2,
      }}
    >
      {initial(displayName, language)}
    </Avatar>
  );
}
