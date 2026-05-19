import { useState } from "react";
import { User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDisplayTitle } from "@/services/api";

interface ContactAvatarProps {
  profilePicUrl?: string | null;
  contactName?: string | null;
  customTitle?: string | null;
  isGroup?: boolean;
  className?: string;
}

export function ContactAvatar({
  profilePicUrl,
  contactName,
  customTitle,
  isGroup,
  className,
}: ContactAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const url = profilePicUrl?.trim();
  const displayName = getDisplayTitle(customTitle, contactName);
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (url && !imgFailed) {
    return (
      <img
        src={url}
        alt={displayName}
        onError={() => setImgFailed(true)}
        className={cn(
          "object-cover rounded-full w-10 h-10 border border-gray-200 dark:border-zinc-800 flex-shrink-0",
          className,
        )}
      />
    );
  }

  if (isGroup) {
    return (
      <div
        className={cn(
          "w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0 border border-gray-200 dark:border-zinc-800",
          className,
        )}
      >
        <Users className="h-5 w-5 text-primary-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0 border border-gray-200 dark:border-zinc-800",
        className,
      )}
    >
      {initials ? (
        <span className="text-sm font-medium text-primary-foreground">
          {initials}
        </span>
      ) : (
        <User className="h-5 w-5 text-primary-foreground" />
      )}
    </div>
  );
}
