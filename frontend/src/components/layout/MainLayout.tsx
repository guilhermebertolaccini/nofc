import { ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * Layout responsivo mobile-first.
 *
 * - `h-[100dvh]` evita o bug de altura com barra dinâmica + teclado no mobile.
 * - Desktop (md+): sidebar fixa à esquerda, recolhível (modo ícones).
 * - Mobile: **FAB** fixo (não ocupa fluxo no header) abre o mesmo menu em um
 *   `Sheet`. Posição `bottom` elevada para não sobrepor o composer do chat
 *   (/atendimento) e respeita `safe-area-inset-bottom` (Home Indicator).
 */
export function MainLayout({ children }: MainLayoutProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isMainNavOpen, setIsMainNavOpen] = useState(true);

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row w-full bg-gradient-to-br from-background via-background to-primary/5 overflow-hidden">
      {/* Decorative blobs — apenas desktop */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none hidden md:block">
        <div className="absolute top-20 left-20 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-32 w-80 h-80 bg-cyan/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-success/10 rounded-full blur-3xl" />
      </div>

      <div className="hidden md:flex flex-shrink-0">
        <AppSidebar
          isCollapsed={!isMainNavOpen}
          onToggleCollapse={() => setIsMainNavOpen((prev) => !prev)}
        />
      </div>

      {/*
        FAB mobile: fora do fluxo (fixed). `bottom` alto o suficiente para
        ficar acima do input sticky do Atendimento (~64–88px + safe area).
      */}
      <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
        <SheetTrigger asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="fixed z-50 md:hidden bottom-[max(6rem,calc(env(safe-area-inset-bottom,0px)+5.5rem))] right-6 h-14 w-14 rounded-full shadow-lg p-0 bg-primary text-primary-foreground hover:bg-primary/90"
            aria-label="Abrir menu"
          >
            <Menu className="h-6 w-6" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="p-0 w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border overflow-hidden"
        >
          <AppSidebar onItemClick={() => setIsMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 relative z-10 min-h-0 overflow-hidden">
        <div className="h-full p-2 md:p-6">{children}</div>
      </main>
    </div>
  );
}
