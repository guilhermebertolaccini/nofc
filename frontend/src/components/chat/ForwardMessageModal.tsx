import { useMemo, useState } from "react";
import { Forward, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContactAvatar } from "@/components/ContactAvatar";
import { cn } from "@/lib/utils";
import { getDisplayTitle } from "@/services/api";

export interface ForwardDestination {
  contactPhone: string;
  contactName: string;
  customTitle?: string | null;
  isGroup?: boolean;
  profilePicUrl?: string | null;
}

interface ForwardMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messagePreview?: string;
  messageType?: string;
  excludeContactPhone?: string;
  destinations: ForwardDestination[];
  onConfirm: (destinationPhone: string) => Promise<void>;
  isForwarding?: boolean;
}

function previewLabel(messageType?: string, message?: string): string {
  const text = message?.trim();
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  switch (messageType) {
    case "image":
      return "Imagem";
    case "video":
      return "Vídeo";
    case "audio":
      return "Áudio";
    case "document":
      return "Documento";
    case "sticker":
      return "Figurinha";
    default:
      return "Mensagem";
  }
}

export function ForwardMessageModal({
  open,
  onOpenChange,
  messagePreview,
  messageType,
  excludeContactPhone,
  destinations,
  onConfirm,
  isForwarding = false,
}: ForwardMessageModalProps) {
  const [search, setSearch] = useState("");
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return destinations
      .filter((d) => d.contactPhone !== excludeContactPhone)
      .filter((d) => {
        if (!q) return true;
        const title = getDisplayTitle(d.customTitle, d.contactName).toLowerCase();
        return (
          title.includes(q) ||
          d.contactPhone.toLowerCase().includes(q) ||
          d.contactName.toLowerCase().includes(q)
        );
      });
  }, [destinations, excludeContactPhone, search]);

  const selected = filtered.find((d) => d.contactPhone === selectedPhone);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSearch("");
      setSelectedPhone(null);
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!selectedPhone) return;
    await onConfirm(selectedPhone);
    setSearch("");
    setSelectedPhone(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2">
            <Forward className="h-5 w-5 text-primary" />
            Encaminhar mensagem
          </DialogTitle>
          <DialogDescription>
            Escolha um contato ou grupo para encaminhar esta mensagem.
          </DialogDescription>
          <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground line-clamp-2">
            {previewLabel(messageType, messagePreview)}
          </div>
        </DialogHeader>

        <div className="px-6 py-3 border-b border-border/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar conversas..."
              className="pl-9"
              autoFocus
            />
          </div>
        </div>

        <ScrollArea className="max-h-[min(50vh,320px)]">
          {filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              Nenhuma conversa encontrada.
            </p>
          ) : (
            <ul className="p-2 space-y-0.5">
              {filtered.map((dest) => {
                const isSelected = selectedPhone === dest.contactPhone;
                const title = getDisplayTitle(dest.customTitle, dest.contactName);
                return (
                  <li key={dest.contactPhone}>
                    <button
                      type="button"
                      onClick={() => setSelectedPhone(dest.contactPhone)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        "hover:bg-primary/5",
                        isSelected && "bg-primary/10 ring-1 ring-primary/20",
                      )}
                    >
                      <ContactAvatar
                        profilePicUrl={dest.profilePicUrl}
                        contactName={dest.contactName}
                        customTitle={dest.customTitle}
                        isGroup={dest.isGroup}
                        className="h-10 w-10"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {dest.isGroup ? "Grupo" : dest.contactPhone}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-border/50 sm:justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isForwarding}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || isForwarding}
            className="min-w-[180px]"
          >
            {isForwarding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Encaminhando...
              </>
            ) : selected ? (
              <>Encaminhar para {getDisplayTitle(selected.customTitle, selected.contactName)}</>
            ) : (
              "Selecione um destino"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
