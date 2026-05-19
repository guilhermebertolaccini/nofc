import { useRef, useState, useCallback, useEffect, type ChangeEvent } from "react";
import { Play, Pause } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface VoiceMessagePlayerProps {
  src: string;
  className?: string;
  /** Balão do operador — ajusta contraste do player */
  isOutbound?: boolean;
}

function formatAudioTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function VoiceMessagePlayer({
  src,
  className,
  isOutbound = false,
}: VoiceMessagePlayerProps) {
  const { resolvedTheme } = useTheme();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

  const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const nextTime = Number(event.target.value);
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleTimeUpdate = () => {
    setCurrentTime(audioRef.current?.currentTime ?? 0);
  };

  const handleLoadedMetadata = () => {
    setDuration(audioRef.current?.duration ?? 0);
  };

  const progressPercent =
    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const trackUnfilled = isOutbound
    ? "rgba(255, 255, 255, 0.1)"
    : resolvedTheme === "dark"
      ? "rgba(255, 255, 255, 0.12)"
      : "rgba(0, 0, 0, 0.12)";

  const displayTime = isPlaying
    ? formatAudioTime(currentTime)
    : formatAudioTime(duration);

  return (
    <div
      className={cn(
        "flex items-center gap-3 w-64 max-w-full p-1",
        className,
      )}
    >
      <button
        type="button"
        onClick={togglePlay}
        className="flex items-center justify-center rounded-full p-2 bg-emerald-500 hover:bg-emerald-600 transition-colors shrink-0 shadow-sm"
        aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? (
          <Pause className="w-5 h-5 text-white fill-white" />
        ) : (
          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={handleSeek}
        aria-label="Progresso do áudio"
        className="audio-slider flex-grow h-4"
        style={{
          background: `linear-gradient(to right, #10b981 ${progressPercent}%, ${trackUnfilled} ${progressPercent}%)`,
        }}
      />

      <span
        className={cn(
          "text-xs tabular-nums min-w-[35px] text-right shrink-0",
          isOutbound
            ? "text-white/70"
            : "text-foreground/60 dark:text-white/70",
        )}
      >
        {displayTime}
      </span>

      <audio
        ref={audioRef}
        src={src}
        className="hidden"
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          if (audioRef.current) {
            audioRef.current.currentTime = 0;
          }
        }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
      />
    </div>
  );
}
