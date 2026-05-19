import { useState } from "react";
import {
  Headphones,
  Eye,
  BookUser,
  Megaphone,
  Table2,
  Filter,
  Ban,
  FileText,
  BarChart3,
  RefreshCw,
  Phone,
  Users,
  Tags,
  Code,
  LogOut,
  Settings,
  Sliders,
  Moon,
  Sun,
  TrendingUp,
  Activity,
  UserCheck,
  Clock,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TaticaLogo } from "./TaticaLogo";
import { useAuth } from "@/contexts/AuthContext";
import { UserRole } from "@/types/auth";
import { NotificationSettingsDialog } from "@/components/settings/NotificationSettingsDialog";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ElementType;
  color: string;
  roles: UserRole[];
}

const menuItems: MenuItem[] = [
  {
    title: "Atendimento",
    url: "/atendimento",
    icon: Headphones,
    color: "text-cyan",
    roles: ["operador", "admin", "supervisor"],
  },
  {
    title: "Supervisionar",
    url: "/supervisionar",
    icon: Eye,
    color: "text-warning",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Contatos",
    url: "/contatos",
    icon: BookUser,
    color: "text-cyan",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Campanhas",
    url: "/campanhas",
    icon: Megaphone,
    color: "text-primary",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Tabulações",
    url: "/tabulacoes",
    icon: Table2,
    color: "text-whatsapp",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Segmentos",
    url: "/segmentos",
    icon: Filter,
    color: "text-destructive",
    roles: ["admin"],
  },
  {
    title: "Blocklist",
    url: "/blocklist",
    icon: Ban,
    color: "text-muted-foreground",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Templates",
    url: "/templates",
    icon: FileText,
    color: "text-primary",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Relatórios",
    url: "/relatorios",
    icon: BarChart3,
    color: "text-success",
    roles: ["supervisor", "admin", "digital"],
  },
  {
    title: "Acompanhamento",
    url: "/acompanhamento",
    icon: Activity,
    color: "text-primary",
    roles: ["admin"],
  },
  {
    title: "Produtividade Ativadores",
    url: "/produtividade-ativadores",
    icon: TrendingUp,
    color: "text-success",
    roles: ["admin"],
  },
  {
    title: "Painel Controle",
    url: "/painel-controle",
    icon: Sliders,
    color: "text-purple-500",
    roles: ["admin"],
  },
  {
    title: "Evolution",
    url: "/evolution",
    icon: RefreshCw,
    color: "text-primary",
    roles: ["admin"],
  },
  {
    title: "Linhas",
    url: "/linhas",
    icon: Phone,
    color: "text-whatsapp",
    roles: ["admin", "ativador"],
  },
  {
    title: "Vida Útil Linhas",
    url: "/relatorios/vida-util",
    icon: Clock,
    color: "text-cyan",
    roles: ["admin"],
  },
  {
    title: "Logs Alocações",
    url: "/relatorios/alocacoes",
    icon: Activity,
    color: "text-green-500",
    roles: ["admin"],
  },
  {
    title: "Regras de Alocação",
    url: "/regras-alocacao",
    icon: Settings,
    color: "text-violet-500",
    roles: ["admin"],
  },
  {
    title: "Criador de Relatórios",
    url: "/criador-relatorio",
    icon: Database,
    color: "text-cyan-500",
    roles: ["admin"],
  },
  {
    title: "Usuários",
    url: "/usuarios",
    icon: Users,
    color: "text-warning",
    roles: ["admin", "digital"],
  },
  {
    title: "Operadores Online",
    url: "/operadores-online",
    icon: UserCheck,
    color: "text-success",
    roles: ["admin"],
  },
  {
    title: "Tags",
    url: "/tags",
    icon: Tags,
    color: "text-cyan",
    roles: ["admin"],
  },
  {
    title: "Logs API",
    url: "/logs",
    icon: Code,
    color: "text-destructive",
    roles: ["admin"],
  },
];

/**
 * AppSidebar
 *
 * `onItemClick`: callback opcional executado ao clicar em qualquer item de
 * navegação ou ação. Usado pelo `MainLayout` para fechar o Sheet do menu
 * mobile assim que o operador escolhe uma rota.
 *
 * `isCollapsed` / `onToggleCollapse`: modo ícones no desktop (MainLayout).
 */
interface AppSidebarProps {
  onItemClick?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarNavItem({
  to,
  icon: Icon,
  iconClassName,
  label,
  isActive,
  isCollapsed,
  onClick,
}: {
  to?: string;
  icon: React.ElementType;
  iconClassName?: string;
  label: string;
  isActive?: boolean;
  isCollapsed?: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 w-full",
    "hover:bg-sidebar-accent/20",
    isActive &&
      "bg-gradient-to-r from-primary/20 to-cyan/10 text-sidebar-foreground",
    isCollapsed && "justify-center px-2 gap-0",
  );

  const content = (
    <>
      <Icon className={cn("w-5 h-5 flex-shrink-0", iconClassName)} />
      <span
        className={cn(
          "text-sm font-medium text-sidebar-foreground whitespace-nowrap transition-all duration-300",
          isCollapsed && "hidden",
        )}
      >
        {label}
      </span>
    </>
  );

  const node = to ? (
    <Link to={to} onClick={onClick} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );

  if (!isCollapsed) return node;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({
  onItemClick,
  isCollapsed = false,
  onToggleCollapse,
}: AppSidebarProps = {}) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  if (!user) return null;

  const filteredItems = menuItems.filter((item) =>
    item.roles.includes(user.role),
  );
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleLabels: Record<UserRole, string> = {
    admin: "Administrador",
    supervisor: "Supervisor",
    operador: "Operador",
    ativador: "Ativador",
    digital: "Digital",
  };

  const toggleTheme = () => {
    setTheme(!theme || theme === "light" ? "dark" : "light");
  };

  const themeLabel =
    !theme || theme === "light" ? "Modo Escuro" : "Modo Claro";

  return (
    <TooltipProvider delayDuration={0}>
      {/*
        Largura:
          - Desktop expandido: w-64.
          - Desktop recolhido: w-16 (somente ícones).
          - Mobile: w-full dentro do SheetContent.
      */}
      <aside
        className={cn(
          "h-full bg-sidebar flex flex-col transition-all duration-300 ease-in-out",
          "w-full",
          isCollapsed ? "md:w-16" : "md:w-64",
        )}
      >
        {/* Logo + toggle (desktop) */}
        <div
          className={cn(
            "border-b border-sidebar-border flex-shrink-0 transition-all duration-300",
            isCollapsed
              ? "flex flex-col items-center gap-2 p-2"
              : "flex items-center justify-between gap-2 p-4",
          )}
        >
          <TaticaLogo
            size={isCollapsed ? "sm" : "xl"}
            showText={false}
            className={cn(isCollapsed && "justify-center")}
          />
          {onToggleCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={onToggleCollapse}
                  aria-label={
                    isCollapsed
                      ? "Expandir menu de navegação"
                      : "Recolher menu de navegação"
                  }
                >
                  {isCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isCollapsed ? "Expandir menu" : "Recolher menu"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto scrollbar-sidebar transition-all duration-300",
            isCollapsed ? "p-2" : "p-3",
          )}
        >
          <ul className="space-y-1">
            {filteredItems.map((item) => {
              const isActive = location.pathname === item.url;

              return (
                <li key={item.url}>
                  <SidebarNavItem
                    to={item.url}
                    icon={item.icon}
                    iconClassName={item.color}
                    label={item.title}
                    isActive={isActive}
                    isCollapsed={isCollapsed}
                    onClick={onItemClick}
                  />
                </li>
              );
            })}

            <li className="pt-2 mt-2 border-t border-sidebar-border">
              <SidebarNavItem
                icon={!theme || theme === "light" ? Moon : Sun}
                iconClassName="text-muted-foreground"
                label={themeLabel}
                isCollapsed={isCollapsed}
                onClick={() => {
                  toggleTheme();
                  onItemClick?.();
                }}
              />
            </li>

            <li>
              <SidebarNavItem
                icon={Settings}
                iconClassName="text-muted-foreground"
                label="Configurações"
                isCollapsed={isCollapsed}
                onClick={() => {
                  setIsSettingsOpen(true);
                  onItemClick?.();
                }}
              />
            </li>
          </ul>
        </nav>

        {/* User Profile */}
        <div
          className={cn(
            "border-t border-sidebar-border flex-shrink-0 transition-all duration-300",
            isCollapsed ? "p-2" : "p-4",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-3",
              isCollapsed && "flex-col gap-2",
            )}
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-primary-foreground">
                {initials}
              </span>
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {roleLabels[user.role]}
                </p>
              </div>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={logout}
                  className={cn(
                    "p-2 rounded-lg hover:bg-sidebar-accent/20 transition-colors flex-shrink-0",
                    isCollapsed && "w-full flex justify-center",
                  )}
                  title="Sair"
                  aria-label="Sair"
                >
                  <LogOut className="w-4 h-4 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              {isCollapsed && <TooltipContent side="right">Sair</TooltipContent>}
            </Tooltip>
          </div>
        </div>
      </aside>

      <NotificationSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </TooltipProvider>
  );
}
