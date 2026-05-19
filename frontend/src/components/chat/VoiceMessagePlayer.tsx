import { useRef, useState, useCallback, useEffect, type ChangeEvent } from "react";
import { Play, Pause } from "lucide-react";
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

  return (
    <div
      className={cn(
        "flex items-center gap-3 w-64 max-w-full min-w-[200px]",
        className,
      )}
    >
      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center transition-colors",
          isOutbound
            ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
            : "bg-primary/10 hover:bg-primary/20 text-primary",
        )}
        aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 fill-current ml-0.5" />
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
        className={cn(
          "flex-1 h-1.5 rounded-full appearance-none cursor-pointer",
          "bg-black/10 dark:bg-white/15",
          isOutbound ? "accent-primary-foreground" : "accent-primary",
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:h-3",
          "[&::-webkit-slider-thumb]:w-3",
          "[&::-webkit-slider-thumb]:rounded-full",
          isOutbound
            ? "[&::-webkit-slider-thumb]:bg-primary-foreground"
            : "[&::-webkit-slider-thumb]:bg-primary",
          "[&::-moz-range-thumb]:h-3",
          "[&::-moz-range-thumb]:w-3",
          "[&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:border-0",
          isOutbound
            ? "[&::-moz-range-thumb]:bg-primary-foreground"
            : "[&::-moz-range-thumb]:bg-primary",
        )}
        style={{
          background: isOutbound
            ? `linear-gradient(to right, rgba(255,255,255,0.85) ${progressPercent}%, rgba(255,255,255,0.2) ${progressPercent}%)`
            : `linear-gradient(to right, hsl(var(--primary)) ${progressPercent}%, rgba(0,0,0,0.1) ${progressPercent}%)`,
        }}
      />

      <span
        className={cn(
          "text-xs tabular-nums flex-shrink-0 min-w-[4.75rem] text-right",
          isOutbound ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
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
      />
    </div>
  );
}
