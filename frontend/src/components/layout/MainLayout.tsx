import { ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "./AppSidebar";
import { TaticaLogo } from "./TaticaLogo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface MainLayoutProps {
  children: ReactNode;
}

/**
 * Layout responsivo mobile-first.
 *
 * Mudanças críticas em relação à versão anterior:
 * - `h-[100dvh]` em vez de `h-screen` para respeitar a barra de endereço
 *   dinâmica do iOS Safari / Android Chrome (`vh` quebra quando o teclado
 *   abre ou a barra retrai, causando "scroll fantasma" e o input do chat
 *   sumindo atrás do teclado).
 * - No mobile (< md), a `AppSidebar` é movida para dentro de um `Sheet`
 *   (drawer overlay) acessível por um botão hamburger no topbar; o espaço
 *   inteiro fica disponível para o conteúdo (essencial para o Atendimento).
 * - No desktop (md+), a sidebar fixa volta a aparecer ao lado.
 * - Padding do `<main>` é reduzido no mobile (`p-2 md:p-6`) para preservar
 *   real estate em telas pequenas.
 */
export function MainLayout({ children }: MainLayoutProps) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="h-[100dvh] flex flex-col md:flex-row w-full bg-gradient-to-br from-background via-background to-primary/5 overflow-hidden">
      {/* Decorative blobs — escondidos no mobile para economizar GPU */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none hidden md:block">
        <div className="absolute top-20 left-20 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute top-40 right-32 w-80 h-80 bg-cyan/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 left-1/3 w-72 h-72 bg-success/10 rounded-full blur-3xl" />
      </div>

      {/* Sidebar fixa (apenas desktop) */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      {/* Topbar mobile com hamburger (apenas < md) */}
      <header className="md:hidden flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/95 backdrop-blur z-20 flex-shrink-0">
        <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          {/*
            Sheet lateral esquerdo carrega EXATAMENTE o mesmo AppSidebar do
            desktop. O prop `onItemClick` fecha o drawer ao tocar em um
            item, evitando que o usuário fique com o menu aberto após
            navegar.
          */}
          <SheetContent
            side="left"
            className="p-0 w-72 max-w-[85vw] bg-sidebar border-r border-sidebar-border overflow-hidden"
          >
            <AppSidebar onItemClick={() => setIsMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        <TaticaLogo size="md" showText={false} />

        {/* spacer simétrico para centralizar o logo */}
        <div className="w-9" />
      </header>

      {/* Conteúdo principal */}
      <main className="flex-1 relative z-10 min-h-0 overflow-hidden">
        <div className="h-full p-2 md:p-6">{children}</div>
      </main>
    </div>
  );
}
