import { cn } from "@/lib/utils";

interface TaticaLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showSubtitle?: boolean;
  showText?: boolean;
  className?: string;
}

export function TaticaLogo({
  size = "md",
  showSubtitle = true,
  showText = true,
  className,
}: TaticaLogoProps) {
  const sizes = {
    sm: { box: "w-10 h-10", text: "text-lg", subtitle: "text-xs" },
    md: { box: "w-12 h-12", text: "text-xl", subtitle: "text-xs" },
    lg: { box: "w-20 h-20", text: "text-3xl", subtitle: "text-sm" },
    xl: { box: "w-32 h-32", text: "text-3xl", subtitle: "text-sm" },
  };

  const s = sizes[size];

  return (
    <div className={cn("flex items-center", showText ? "gap-3" : "", className)}>
      <div className={cn(s.box, "flex items-center justify-center")}>
        <img
          src="/logo.png"
          alt="Tatica Atendimentos"
          className="w-full h-full object-contain"
        />
      </div>
      {showText && (
        <div className="flex flex-col">
          <span
            className={cn(
              s.text,
              "font-bold text-sidebar-foreground tracking-tight leading-tight",
            )}
          >
            Tatica Atendimentos
          </span>
          {showSubtitle && (
            <span className={cn(s.subtitle, "text-muted-foreground")}>
              Plataforma de atendimento
            </span>
          )}
        </div>
      )}
    </div>
  );
}
