import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  createElement,
  type ChangeEvent,
  type SyntheticEvent,
} from "react";
import {
  Plus,
  Send,
  FileText,
  File as FileIcon,
  MessageCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Wifi,
  WifiOff,
  Edit,
  Pencil,
  UserCheck,
  X,
  Check,
  Phone as PhoneIcon,
  AlertTriangle,
  RefreshCw,
  Search,
  Download,
  Paperclip,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Lock as LockIcon,
  Pin,
  PinOff,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { ContactAvatar } from "@/components/ContactAvatar";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNotificationSound } from "@/hooks/useNotificationSound";
import { toast } from "@/hooks/use-toast";
import {
  conversationsService,
  tabulationsService,
  contactsService,
  templatesService,
  segmentsService,
  Contact,
  Conversation as APIConversation,
  Tabulation,
  Template,
  getAuthToken,
  API_BASE_URL,
  getDisplayTitle,
  ApiRequestError,
} from "@/services/api";
import {
  useRealtimeConnection,
  useRealtimeSubscription,
} from "@/hooks/useRealtimeConnection";
import { WS_EVENTS, realtimeSocket } from "@/services/websocket";
import {
  format,
  isToday,
  isYesterday,
  differenceInCalendarDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { renderTextWithLinks, normalizeBrazilPhoneDigits } from "@/utils/textUtils";

/**
 * Resolve qualquer `mediaUrl` para uma URL utilizável pelo navegador.
 *
 * Regras (em ordem de prioridade):
 *   1. URL absoluta (http/https) → usa como veio.
 *   2. `data:` URI (base64 inline) → usa como veio.
 *   3. Path relativo (com ou sem `/` inicial) → concatena com
 *      `VITE_API_URL` (ou fallback `http://localhost:3000`).
 *   4. Valor falsy → retorna `null` para o caller renderizar fallback.
 *
 * Por que isso resolve o Problema 1 (imagem quebrada no F5):
 *   Antes, cada `<img>` repetia inline o ternário
 *   `url.startsWith("http") ? url : ${API_BASE_URL}${url}` — qualquer
 *   discrepância (URL sem `/` inicial, `mediaUrl` undefined, etc) gerava
 *   `src` malformado. Centralizando aqui, garantimos que tempo-real e
 *   refresh resolvam EXATAMENTE para a mesma URL final.
 */
function resolveMediaUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:")) return url;
  const normalized = url.startsWith("/") ? url : `/${url}`;
  return `${API_BASE_URL}${normalized}`;
}

/** Limite seguro para mídia no WhatsApp (envio típico ~16 MB). */
const WHATSAPP_MAX_FILE_BYTES = 16 * 1024 * 1024;

/** `accept` do input — tipos pedidos pelo produto + áudio/vídeo (mensagens multimédia). */
const FILE_INPUT_ACCEPT =
  "image/*,video/*,audio/*," +
  "application/pdf," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-powerpoint," +
  "application/vnd.openxmlformats-officedocument.presentationml.presentation," +
  "text/plain,text/csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

/** Quando `File.type` vem vazio (comum em alguns SO), inferir MIME pela extensão. */
function guessMimeFromFileName(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  const ext =
    i >= 0 ? fileName.slice(i + 1).toLowerCase().trim() : "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
    svg: "image/svg+xml",
    heic: "image/heic",
    heif: "image/heif",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    webm: "video/webm",
    "3gp": "video/3gpp",
    flv: "video/x-flv",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    aac: "audio/aac",
    flac: "audio/flac",
    pdf: "application/pdf",
    doc: "application/msword",
    docx:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    rtf: "application/rtf",
    csv: "text/csv",
    txt: "text/plain",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    "7z": "application/x-7z-compressed",
    gz: "application/gzip",
    tar: "application/x-tar",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    xml: "text/xml",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
  };
  return ext ? map[ext] ?? "" : "";
}

interface ConversationGroup {
  contactPhone: string;
  contactName: string;
  /** Título manual definido pelo operador (Shared Inbox). */
  customTitle?: string | null;
  lastMessage: string;
  lastMessageTime: string;
  isFromContact: boolean;
  unread?: boolean;
  unreadCount?: number;
  isPinned?: boolean;
  isGroup?: boolean;
  profilePicUrl?: string | null;
  /** Mensagens do thread; `reactions` é derivado de `reactionsJson` ao carregar. */
  messages: (APIConversation & { reactions?: string[] })[];
  isTabulated?: boolean; // Indica se a conversa foi tabulada
}

type SidebarFilterType = "all" | "unread" | "favorites" | "groups";

function sortConversationGroups(
  groups: ConversationGroup[],
): ConversationGroup[] {
  return [...groups].sort((a, b) => {
    const aPinned = !!a.isPinned;
    const bPinned = !!b.isPinned;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return (
      new Date(b.lastMessageTime).getTime() -
      new Date(a.lastMessageTime).getTime()
    );
  });
}

function filterConversationGroups(
  groups: ConversationGroup[],
  filter: SidebarFilterType,
): ConversationGroup[] {
  switch (filter) {
    case "unread":
      return groups.filter((g) => (g.unreadCount ?? 0) > 0);
    case "favorites":
      return groups.filter((g) => !!g.isPinned);
    case "groups":
      return groups.filter((g) => !!g.isGroup);
    case "all":
    default:
      return groups;
  }
}

/** Mensagem enriquecida com reações parseadas do banco (`reactionsJson`). */
type ChatRow = APIConversation & { reactions?: string[] };

function parseReactionsFromRow(m: APIConversation): string[] | undefined {
  if (!m.reactionsJson) return undefined;
  try {
    const p = JSON.parse(m.reactionsJson) as unknown;
    return Array.isArray(p) ? (p as string[]) : undefined;
  } catch {
    return undefined;
  }
}

function withReactions(m: APIConversation): ChatRow {
  const reactions = parseReactionsFromRow(m);
  return reactions !== undefined ? { ...m, reactions } : { ...m };
}

/** Mensagem com correlato na Evolution (editar / apagar para todos). */
function messageHasWaMessageId(m: Pick<APIConversation, "waMessageId">): boolean {
  const id = m.waMessageId;
  return typeof id === "string" && id.trim().length > 0;
}

/** Info temporária de quem está digitando na sala atual. */
interface TypingInfo {
  userId: number;
  userName: string;
  expiresAt: number;
}

export default function Atendimento() {
  const { user } = useAuth();
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationGroup | null>(null);
  const [message, setMessage] = useState("");
  const [isNewConversationOpen, setIsNewConversationOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationGroup[]>([]);
  const [tabulations, setTabulations] = useState<Tabulation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactCpf, setNewContactCpf] = useState("");
  const [newContactContract, setNewContactContract] = useState("");
  const [newContactMessage, setNewContactMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { playMessageSound, playSuccessSound, playErrorSound } =
    useNotificationSound();
  const { isConnected: isRealtimeConnected } = useRealtimeConnection();

  // Estado para edição de contato
  const [isEditContactOpen, setIsEditContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactCpf, setEditContactCpf] = useState("");
  const [editContactContract, setEditContactContract] = useState("");
  const [editContactIsCPC, setEditContactIsCPC] = useState(false);
  const [isSavingContact, setIsSavingContact] = useState(false);

  // SHARED INBOX – Modal de renomear título do cliente/grupo
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // SHARED INBOX – "Fulano está digitando..." na conversa aberta
  const [typingUsers, setTypingUsers] = useState<Map<number, TypingInfo>>(
    new Map(),
  );
  /** Edição de mensagem enviada pelo atendimento (Evolution / painel) */
  const [operatorEditOpen, setOperatorEditOpen] = useState(false);
  const [operatorEditMessage, setOperatorEditMessage] =
    useState<ChatRow | null>(null);
  const [operatorEditText, setOperatorEditText] = useState("");
  const [operatorEditSaving, setOperatorEditSaving] = useState(false);
  const [operatorMessageActionId, setOperatorMessageActionId] = useState<
    number | null
  >(null);
  const previousConversationsRef = useRef<ConversationGroup[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  // Estado para filtro da sidebar (modelo WhatsApp)
  const [conversationFilter, setConversationFilter] =
    useState<SidebarFilterType>("all");
  const [isPinToggling, setIsPinToggling] = useState(false);

  /** Modo foco no desktop: recolhe a lista lateral para dar mais espaço ao chat. */
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);

  // Estado para pesquisa de tabulação
  const [tabulationSearch, setTabulationSearch] = useState("");

  // Estado para notificação de linha banida
  const [lineBannedNotification, setLineBannedNotification] = useState<{
    bannedLinePhone: string;
    newLinePhone: string | null;
    contactsToRecall: Array<{ phone: string; name: string }>;
    message: string;
  } | null>(null);
  const [isRecallingContact, setIsRecallingContact] = useState<string | null>(
    null,
  );

  // Estado para modo teste administrador (apenas admins)
  const [isAdminTestMode, setIsAdminTestMode] = useState(false);

  // Estado para templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(
    null,
  );
  const [templateVariables, setTemplateVariables] = useState<
    Record<string, string>
  >({});
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [segmentAllowsFreeMessage, setSegmentAllowsFreeMessage] =
    useState<boolean>(true); // Default true para não bloquear
  const [segmentDuploCpcEnabled, setSegmentDuploCpcEnabled] =
    useState<boolean>(false); // Default false para não exigir CPC
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to new messages in real-time
  //
  // ⚠️ Defense-in-depth contra DUPLICAÇÃO de mensagens:
  // Mesmo com o backend já deduplicando o fan-out via fetchSockets na room,
  // o React em StrictMode (dev) pode invocar o handler 2× durante o reflow
  // e o socket pode entregar uma mensagem retransmitida em raras condições
  // de reconexão. Aqui aplicamos uma trava de UNICIDADE por `id`:
  //   - antes de fazer push em `messages`, verificamos se já existe `m.id === newMsg.id`.
  // Sem isso, o operador via 2-3 balões idênticos na tela; ao dar F5,
  // como o estado é reidratado do banco (sem repetidos), tudo voltava ao normal.
  useRealtimeSubscription(
    WS_EVENTS.NEW_MESSAGE,
    (data: any) => {
      console.log("[Atendimento] New message received:", data);

      if (data.message) {
        const newMsg = withReactions(data.message as APIConversation);

        // Play sound for incoming messages
        if (newMsg.sender === "contact") {
          playMessageSound();
        }

        setConversations((prev) => {
          const existing = prev.find(
            (c) => c.contactPhone === newMsg.contactPhone,
          );
          const isOpen =
            selectedPhoneRef.current === newMsg.contactPhone;

          if (existing) {
            const updated = prev.map((conv) => {
              if (conv.contactPhone === newMsg.contactPhone) {
                if (
                  newMsg.id != null &&
                  conv.messages.some((m) => m.id === newMsg.id)
                ) {
                  return conv;
                }
                const fromContact = newMsg.sender === "contact";
                const nextUnread =
                  fromContact && !isOpen
                    ? (conv.unreadCount ?? 0) + 1
                    : conv.unreadCount ?? 0;
                return {
                  ...conv,
                  messages: [...conv.messages, newMsg].sort(
                    (a, b) =>
                      new Date(a.datetime).getTime() -
                      new Date(b.datetime).getTime(),
                  ),
                  lastMessage: newMsg.message,
                  lastMessageTime: newMsg.datetime,
                  isFromContact: fromContact,
                  isGroup:
                    conv.isGroup ??
                    newMsg.isGroup ??
                    newMsg.contactPhone.includes("@g.us"),
                  unread: nextUnread > 0,
                  unreadCount: nextUnread,
                };
              }
              return conv;
            });
            return sortConversationGroups(updated);
          }

          const newGroup: ConversationGroup = {
            contactPhone: newMsg.contactPhone,
            contactName: newMsg.contactName,
            customTitle: newMsg.customTitle ?? null,
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === "contact",
            isGroup:
              newMsg.isGroup ?? newMsg.contactPhone.includes("@g.us"),
            isPinned: newMsg.isPinned ?? false,
            profilePicUrl: newMsg.profilePicUrl ?? null,
            messages: [newMsg],
            unread: newMsg.sender === "contact" && !isOpen,
            unreadCount:
              newMsg.sender === "contact" && !isOpen ? 1 : 0,
          };
          return sortConversationGroups([newGroup, ...prev]);
        });

        // ⛡ Guard de roteamento: só inserir a newMsg no chat ABERTO
        // (`selectedConversation`) se ela for da MESMA conversa.
        //
        // Bug histórico: anteriormente o append era condicionado apenas
        // por `selectedPhoneRef.current === newMsg.contactPhone` por fora
        // do `setSelectedConversation`. Em raras condições de troca rápida
        // de chat / refs stale, uma mensagem da conversa B podia "vazar"
        // para o chat A que estava aberto. Agora a comparação é refeita
        // DENTRO do updater funcional, usando `prev.contactPhone` — esse
        // valor é sempre o estado mais recente no momento da atualização,
        // imune a closures stale ou refs desatualizadas.
        setSelectedConversation((prev) => {
          if (!prev) return prev;
          // Se o chat aberto NÃO é o desta mensagem, apenas atualizar a
          // sidebar (já feito acima por setConversations) e preservar o
          // chat aberto intacto.
          if (prev.contactPhone !== newMsg.contactPhone) {
            return prev;
          }
          // Dedupe por id (defesa adicional contra reentrega de evento).
          if (
            newMsg.id != null &&
            prev.messages.some((m) => m.id === newMsg.id)
          ) {
            return prev;
          }
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort(
              (a, b) =>
                new Date(a.datetime).getTime() -
                new Date(b.datetime).getTime(),
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
            isFromContact: newMsg.sender === "contact",
          };
        });
      }
    },
    [playMessageSound],
  ); // Removido selectedConversation da dependência

  /** Reação WhatsApp: atualiza emojis no balão da mensagem alvo (id interno). */
  useRealtimeSubscription(
    WS_EVENTS.MESSAGE_REACTION,
    (data: {
      contactPhone?: string;
      targetMessageId?: number;
      emojis?: string[];
    }) => {
      const phone = data?.contactPhone;
      const targetId = data?.targetMessageId;
      const emojis = data?.emojis;
      if (!phone || targetId == null || !Array.isArray(emojis)) return;

      const json = JSON.stringify(emojis);
      const patchGroup = (g: ConversationGroup): ConversationGroup => ({
        ...g,
        messages: g.messages.map((m) =>
          m.id === targetId
            ? { ...m, reactionsJson: json, reactions: [...emojis] }
            : m,
        ),
      });

      setConversations((prev) =>
        prev.map((g) => (g.contactPhone === phone ? patchGroup(g) : g)),
      );
      setSelectedConversation((prev) => {
        if (!prev || prev.contactPhone !== phone) return prev;
        return patchGroup(prev);
      });
    },
    [],
  );

  useRealtimeSubscription(
    WS_EVENTS.MESSAGE_UPDATED,
    (data: { message?: APIConversation }) => {
      const raw = data?.message;
      if (raw?.id == null || !raw.contactPhone) return;
      const row = withReactions(raw);
      const phone = raw.contactPhone;
      setConversations((prev) =>
        prev.map((g) =>
          g.contactPhone !== phone
            ? g
            : {
                ...g,
                messages: g.messages.map((m) => (m.id === row.id ? row : m)),
              },
        ),
      );
      setSelectedConversation((prev) => {
        if (!prev || prev.contactPhone !== phone) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === row.id ? row : m)),
        };
      });
    },
    [],
  );

  /** Nome real do grupo/contato resolvido pelo backend (Evolution API). */
  useRealtimeSubscription(
    WS_EVENTS.CONVERSATION_UPDATED,
    (data: {
      contactPhone?: string;
      contactName?: string;
      customTitle?: string | null;
      isPinned?: boolean;
      profilePicUrl?: string | null;
    }) => {
      const phone = data?.contactPhone?.trim();
      if (!phone) return;

      const nextContactName =
        typeof data.contactName === "string" && data.contactName.trim()
          ? data.contactName.trim()
          : undefined;
      const customTitleProvided = data.customTitle !== undefined;
      const isPinnedProvided = data.isPinned !== undefined;
      const profilePicProvided = data.profilePicUrl !== undefined;

      const patchGroup = (g: ConversationGroup): ConversationGroup => {
        if (g.contactPhone !== phone) return g;
        return {
          ...g,
          ...(nextContactName ? { contactName: nextContactName } : {}),
          ...(customTitleProvided ? { customTitle: data.customTitle ?? null } : {}),
          ...(isPinnedProvided ? { isPinned: !!data.isPinned } : {}),
          ...(profilePicProvided
            ? { profilePicUrl: data.profilePicUrl ?? null }
            : {}),
        };
      };

      setConversations((prev) => sortConversationGroups(prev.map(patchGroup)));
      setSelectedConversation((prev) => (prev ? patchGroup(prev) : prev));
    },
    [],
  );

  // Subscribe to message sent confirmation
  useRealtimeSubscription(
    "message-sent",
    (data: any) => {
      console.log("[Atendimento] Message sent confirmation:", data);
      if (data?.message) {
        // Adicionar mensagem à conversa ativa
        const newMsg = withReactions(data.message as APIConversation);

        // Resetar loading de envio de mensagem
        setIsSending(false);

        // Mostrar toast de sucesso
        playSuccessSound();
        toast({
          title: "Mensagem enviada",
          description: "Sua mensagem foi enviada com sucesso",
        });

        // Se estava criando nova conversa, resetar loading
        // O modal já foi fechado anteriormente, apenas resetar o estado
        setIsCreatingConversation(false);

        setConversations((prev) => {
          const existing = prev.find(
            (c) => c.contactPhone === newMsg.contactPhone,
          );

          if (existing) {
            return prev
              .map((conv) => {
                if (conv.contactPhone === newMsg.contactPhone) {
                  // ⛔ DEDUPE por id (mesma defesa do new_message)
                  if (
                    newMsg.id != null &&
                    conv.messages.some((m) => m.id === newMsg.id)
                  ) {
                    return conv;
                  }
                  return {
                    ...conv,
                    messages: [...conv.messages, newMsg].sort(
                      (a, b) =>
                        new Date(a.datetime).getTime() -
                        new Date(b.datetime).getTime(),
                    ),
                    lastMessage: newMsg.message,
                    lastMessageTime: newMsg.datetime,
                    isFromContact: false,
                  };
                }
                return conv;
              })
              .sort(
                (a, b) =>
                  new Date(b.lastMessageTime).getTime() -
                  new Date(a.lastMessageTime).getTime(),
              );
          } else {
            // Nova conversa criada
            const newGroup: ConversationGroup = {
              contactPhone: newMsg.contactPhone,
              contactName: newMsg.contactName,
              lastMessage: newMsg.message,
              lastMessageTime: newMsg.datetime,
              isFromContact: false,
              messages: [newMsg],
            };
            return [newGroup, ...prev];
          }
        });

        // ⛡ Guard de roteamento: ver comentário longo no listener
        // WS_EVENTS.NEW_MESSAGE. Mesma defesa aplicada aqui — comparamos
        // `prev.contactPhone` dentro do updater funcional para impedir que
        // uma confirmação de envio caia no chat errado quando o operador
        // trocou de conversa entre o emit e o ack.
        setSelectedConversation((prev) => {
          if (!prev) return prev;
          if (prev.contactPhone !== newMsg.contactPhone) {
            return prev;
          }
          if (
            newMsg.id != null &&
            prev.messages.some((m) => m.id === newMsg.id)
          ) {
            return prev;
          }
          return {
            ...prev,
            messages: [...prev.messages, newMsg].sort(
              (a, b) =>
                new Date(a.datetime).getTime() -
                new Date(b.datetime).getTime(),
            ),
            lastMessage: newMsg.message,
            lastMessageTime: newMsg.datetime,
          };
        });
      }
    },
    [playSuccessSound, isNewConversationOpen],
  ); // Adicionar dependências

  // Subscribe to message errors (bloqueios CPC, repescagem, etc)
  useRealtimeSubscription(
    "message-error",
    (data: any) => {
      console.log("[Atendimento] Message error received:", data);
      if (data?.error) {
        playErrorSound();

        // Resetar loading de envio de mensagem
        setIsSending(false);

        // Resetar loading de criação de conversa
        setIsCreatingConversation(false);

        // Determinar título baseado no tipo de erro
        let title = "Mensagem bloqueada";
        if (data.error.includes("CPC")) {
          title = "Bloqueio de CPC";
        } else if (data.error.includes("alocação de linha")) {
          title = "Aguarde alocação";
        } else if (
          data.error.includes("repescagem") ||
          (data.error.includes("Aguarde") && !data.error.includes("alocação"))
        ) {
          title = "Bloqueio de Repescagem";
        } else if (data.error.includes("permissão")) {
          title = "Sem permissão";
        } else if (data.error.includes("não existe no WhatsApp")) {
          title = "Número inválido";
        }

        toast({
          title,
          description: data.error,
          variant: "destructive",
          duration: data.hoursRemaining ? 8000 : 5000,
          forceShow: true,
        });
      }
    },
    [playErrorSound],
  );

  // ─────────────────────────────────────────────────────────────────────
  // LINHA BANIDA — Modal "fantasma" reativado.
  //
  // O backend dispara `WS_EVENTS.LINE_BANNED` (`'line-banned'`) quando a
  // linha atribuída ao operador é marcada como banida pelo monitor de
  // saúde ou pelo fluxo de envio (handleBannedLine → reallocate). Até
  // agora a UI tinha o estado + o modal renderizado, mas faltava o
  // listener que setava `lineBannedNotification`, deixando o operador
  // tentar enviar em uma linha morta.
  //
  // Aceitamos um payload tolerante para evitar quebrar caso o backend
  // emita variações de nome de campo (ex.: `linePhone` vs `bannedLinePhone`).
  // ─────────────────────────────────────────────────────────────────────
  useRealtimeSubscription(
    WS_EVENTS.LINE_BANNED,
    (data: any) => {
      console.log("[Atendimento] Line banned event received:", data);
      if (!data) return;

      // Toca som de alerta para chamar atenção do operador.
      playErrorSound();

      // Normalização defensiva do payload — qualquer um destes campos
      // pode vir do backend; usamos o primeiro não-vazio.
      const bannedLinePhone: string =
        data.bannedLinePhone ||
        data.linePhone ||
        data.phone ||
        data.oldLinePhone ||
        "";
      const newLinePhone: string | null =
        data.newLinePhone || data.replacementLinePhone || null;

      const rawContacts: any[] = Array.isArray(data.contactsToRecall)
        ? data.contactsToRecall
        : Array.isArray(data.contacts)
          ? data.contacts
          : [];
      const contactsToRecall = rawContacts
        .map((c) => ({
          phone: c?.phone || c?.contactPhone || "",
          name: c?.name || c?.contactName || c?.phone || "",
        }))
        .filter((c) => !!c.phone);

      const message: string =
        data.message ||
        (newLinePhone
          ? `A linha ${bannedLinePhone || "atribuída"} foi banida. Você foi realocado para a linha ${newLinePhone}.`
          : `A linha ${bannedLinePhone || "atribuída"} foi banida e nenhuma linha substituta está disponível no momento.`);

      // Aborta envios em andamento — a linha está morta.
      setIsSending(false);
      setIsCreatingConversation(false);

      setLineBannedNotification({
        bannedLinePhone,
        newLinePhone,
        contactsToRecall,
        message,
      });
    },
    [playErrorSound],
  );

  const scrollToBottom = () => {
    if (messagesScrollRef.current) {
      const scrollContainer = messagesScrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  };

  // Ref para armazenar o contactPhone selecionado (evita loop infinito)
  const selectedPhoneRef = useRef<string | null>(null);

  // Atualizar ref quando selectedConversation mudar
  useEffect(() => {
    selectedPhoneRef.current = selectedConversation?.contactPhone || null;
  }, [selectedConversation?.contactPhone]);

  // SHARED INBOX – Entrar/sair da sala da conversa selecionada
  // Garante que typing/new_message só chegam dos clientes que o operador abriu.
  useEffect(() => {
    const phone = selectedConversation?.contactPhone;
    if (!phone) return;
    realtimeSocket.joinConversation(phone);
    // Limpar indicador antigo ao trocar de conversa
    setTypingUsers(new Map());
    return () => {
      realtimeSocket.leaveConversation(phone);
    };
  }, [selectedConversation?.contactPhone]);

  // SHARED INBOX – Listener de "user-typing" (restrito à sala atual)
  useRealtimeSubscription(
    WS_EVENTS.USER_TYPING,
    (data: {
      contactPhone: string;
      userId: number;
      userName: string;
      typing: boolean;
    }) => {
      if (!data || data.contactPhone !== selectedPhoneRef.current) return;
      if (user?.id && data.userId === user.id) return; // ignora a si mesmo
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (data.typing) {
          next.set(data.userId, {
            userId: data.userId,
            userName: data.userName || "Usuário",
            expiresAt: Date.now() + 4000, // auto-cleanup em 4s sem update
          });
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    },
    [user?.id],
  );

  // Auto-cleanup do typing (caso o "stop" se perca)
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers((prev) => {
        if (prev.size === 0) return prev;
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [k, v] of next) {
          if (v.expiresAt <= now) {
            next.delete(k);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  // Envio do evento "typing" com debounce ao digitar
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentAtRef = useRef<number>(0);
  const emitTyping = useCallback(
    (phone: string | undefined | null) => {
      if (!phone) return;
      const now = Date.now();
      // Throttle: 1 emissão de "true" por ~1s
      if (now - lastTypingSentAtRef.current > 1000) {
        realtimeSocket.sendTyping(phone, true);
        lastTypingSentAtRef.current = now;
      }
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = setTimeout(() => {
        realtimeSocket.sendTyping(phone, false);
        lastTypingSentAtRef.current = 0;
      }, 1500);
    },
    [],
  );

  // Lista derivada de "Fulano está digitando..."
  const typingDisplay = useMemo(() => {
    const names = Array.from(typingUsers.values()).map((t) => t.userName);
    if (names.length === 0) return null;
    if (names.length === 1) return `${names[0]} está digitando...`;
    if (names.length === 2)
      return `${names[0]} e ${names[1]} estão digitando...`;
    return `${names[0]} e mais ${names.length - 1} estão digitando...`;
  }, [typingUsers]);

  const displayedConversations = useMemo(
    () =>
      sortConversationGroups(
        filterConversationGroups(conversations, conversationFilter),
      ),
    [conversations, conversationFilter],
  );

  const loadConversations = useCallback(async () => {
    try {
      // Carregar tanto conversas ativas quanto tabuladas para ter todos os dados
      const [activeData, tabulatedData] = await Promise.all([
        conversationsService.getActive(),
        conversationsService.getTabulated().catch(() => []), // Se falhar, retorna array vazio
      ]);

      // Combinar todos os dados
      const allData = [...activeData, ...tabulatedData];

      // Group conversations by contact phone
      const groupedMap = new Map<string, ConversationGroup>();

      allData.forEach((conv) => {
        const existing = groupedMap.get(conv.contactPhone);
        const isTabulated =
          conv.tabulation !== null && conv.tabulation !== undefined;

        if (existing) {
          existing.messages.push(withReactions(conv));
          if (conv.isPinned) existing.isPinned = true;
          if (conv.isGroup) existing.isGroup = true;
          if (conv.profilePicUrl) existing.profilePicUrl = conv.profilePicUrl;
          // Update last message if this one is more recent
          const convTime = new Date(conv.datetime).getTime();
          const existingTime = new Date(existing.lastMessageTime).getTime();
          if (convTime > existingTime) {
            existing.lastMessage = conv.message;
            existing.lastMessageTime = conv.datetime;
            existing.isFromContact = conv.sender === "contact";
            existing.isTabulated = isTabulated;
          }
          // Se qualquer mensagem for tabulada, a conversa é tabulada
          if (isTabulated) {
            existing.isTabulated = true;
          }
        } else {
          groupedMap.set(conv.contactPhone, {
            contactPhone: conv.contactPhone,
            contactName: conv.contactName,
            customTitle: conv.customTitle ?? null,
            lastMessage: conv.message,
            lastMessageTime: conv.datetime,
            isFromContact: conv.sender === "contact",
            isTabulated: isTabulated,
            isPinned: conv.isPinned ?? false,
            isGroup:
              conv.isGroup ?? conv.contactPhone.includes("@g.us"),
            profilePicUrl: conv.profilePicUrl ?? null,
            unreadCount: 0,
            messages: [withReactions(conv)],
          });
        }
      });

      const groups = sortConversationGroups(
        Array.from(groupedMap.values()).map((group) => ({
          ...group,
          messages: group.messages
            .sort(
              (a, b) =>
                new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
            )
            .map(withReactions),
        })),
      );

      setConversations(groups);

      // Update selected conversation if it exists (usando ref para evitar loop)
      const currentSelectedPhone = selectedPhoneRef.current;
      if (currentSelectedPhone) {
        const updated = groups.find(
          (g) => g.contactPhone === currentSelectedPhone,
        );
        if (updated) {
          setSelectedConversation(updated);
        }
      }
    } catch (error) {
      console.error("Error loading conversations:", error);
    } finally {
      setIsLoading(false);
    }
  }, []); // Filtro aplicado via displayedConversations (useMemo)

  const phonesMatch = useCallback((a: string, b: string) => {
    const da = a.replace(/\D/g, "");
    const db = b.replace(/\D/g, "");
    return da === db || a === b;
  }, []);

  const handleSelectConversation = useCallback((conv: ConversationGroup) => {
    setSelectedConversation({
      ...conv,
      unread: false,
      unreadCount: 0,
    });
    setConversations((prev) =>
      sortConversationGroups(
        prev.map((c) =>
          c.contactPhone === conv.contactPhone
            ? { ...c, unread: false, unreadCount: 0 }
            : c,
        ),
      ),
    );

    if (!conv.profilePicUrl) {
      contactsService
        .getByPhone(conv.contactPhone)
        .then((contact) => {
          const pic = contact?.profilePicUrl?.trim();
          if (!pic) return;
          const patch = (g: ConversationGroup): ConversationGroup =>
            g.contactPhone === conv.contactPhone
              ? { ...g, profilePicUrl: pic }
              : g;
          setConversations((prev) => sortConversationGroups(prev.map(patch)));
          setSelectedConversation((prev) =>
            prev?.contactPhone === conv.contactPhone
              ? { ...prev, profilePicUrl: pic }
              : prev,
          );
        })
        .catch(() => {});
    }
  }, []);

  const handleTogglePin = useCallback(async () => {
    if (!selectedConversation || isPinToggling) return;

    const phone = selectedConversation.contactPhone;
    const nextPinned = !selectedConversation.isPinned;

    const patch = (g: ConversationGroup): ConversationGroup =>
      g.contactPhone === phone ? { ...g, isPinned: nextPinned } : g;

    setConversations((prev) => sortConversationGroups(prev.map(patch)));
    setSelectedConversation((prev) =>
      prev ? { ...prev, isPinned: nextPinned } : prev,
    );
    setIsPinToggling(true);

    try {
      await contactsService.togglePin(phone);
      toast({
        title: nextPinned ? "Conversa fixada" : "Conversa desfixada",
        description: nextPinned
          ? "Esta conversa ficará no topo da lista."
          : "A conversa voltou à ordenação normal.",
      });
    } catch (error) {
      const revert = (g: ConversationGroup): ConversationGroup =>
        g.contactPhone === phone ? { ...g, isPinned: !nextPinned } : g;
      setConversations((prev) => sortConversationGroups(prev.map(revert)));
      setSelectedConversation((prev) =>
        prev ? { ...prev, isPinned: !nextPinned } : prev,
      );
      toast({
        title: "Erro ao fixar conversa",
        description:
          error instanceof Error ? error.message : "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsPinToggling(false);
    }
  }, [selectedConversation, isPinToggling]);

  /** Abre chat 1x1 ao clicar em telefone dentro de uma mensagem. */
  const handlePhoneClick = useCallback(
    async (rawPhone: string) => {
      const phone = normalizeBrazilPhoneDigits(rawPhone);
      if (!phone || phone.length < 12) {
        toast({
          title: "Número inválido",
          description: "Não foi possível reconhecer o telefone.",
          variant: "destructive",
        });
        return;
      }

      const existing = conversations.find(
        (c) =>
          !c.contactPhone.includes("@g.us") &&
          phonesMatch(c.contactPhone, phone),
      );

      if (existing) {
        setConversationFilter("all");
        setSelectedConversation(existing);
        return;
      }

      try {
        const messages = await conversationsService.getByContact(phone);
        if (messages?.length) {
          const sorted = [...messages]
            .sort(
              (a, b) =>
                new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
            )
            .map(withReactions);
          const last = sorted[sorted.length - 1];
          const isTabulated =
            last.tabulation !== null && last.tabulation !== undefined;
          const group: ConversationGroup = {
            contactPhone: phone,
            contactName: last.contactName || phone,
            customTitle: last.customTitle ?? null,
            lastMessage: last.message,
            lastMessageTime: last.datetime,
            isFromContact: last.sender === "contact",
            isTabulated,
            isPinned: last.isPinned ?? false,
            isGroup: last.isGroup ?? phone.includes("@g.us"),
            unreadCount: 0,
            messages: sorted,
          };

          setConversations((prev) => {
            const idx = prev.findIndex((c) =>
              phonesMatch(c.contactPhone, phone),
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = group;
              return sortConversationGroups(next);
            }
            return sortConversationGroups([group, ...prev]);
          });
          setConversationFilter("all");
          setSelectedConversation(group);
          return;
        }
      } catch (error) {
        console.warn("[Atendimento] Falha ao buscar contato por telefone:", error);
      }

      setNewContactPhone(phone);
      setNewContactName("");
      setIsNewConversationOpen(true);
    },
    [conversations, phonesMatch],
  );

  // Subscribe to line reallocation (depois de loadConversations estar definido)
  useRealtimeSubscription(
    "line-reallocated",
    (data: any) => {
      console.log("[Atendimento] Line reallocated:", data);
      if (data?.newLinePhone) {
        playSuccessSound();
        toast({
          title: "Linha realocada",
          description:
            data.message ||
            `Nova linha ${data.newLinePhone} foi atribuída automaticamente.`,
          duration: 8000,
        });

        // Recarregar conversas para atualizar com a nova linha
        setTimeout(() => {
          loadConversations();
        }, 1000);
      }
    },
    [playSuccessSound, loadConversations],
  );

  const loadTabulations = useCallback(async () => {
    try {
      const data = await tabulationsService.list();
      setTabulations(data);
    } catch (error) {
      console.error("Error loading tabulations:", error);
    }
  }, []);

  // Carregar dados do contato para edição
  const openEditContact = useCallback(async () => {
    if (!selectedConversation) return;

    try {
      const contact = await contactsService.getByPhone(
        selectedConversation.contactPhone,
      );
      if (contact) {
        setEditingContact(contact);
        setEditContactName(contact.name);
        setEditContactCpf(contact.cpf || "");
        setEditContactContract(contact.contract || "");
        setEditContactIsCPC(contact.isCPC || false);
        setIsEditContactOpen(true);
      } else {
        // Contato não existe, criar com dados básicos
        setEditingContact(null);
        setEditContactName(selectedConversation.contactName);
        setEditContactCpf("");
        setEditContactContract("");
        setEditContactIsCPC(false);
        setIsEditContactOpen(true);
      }
    } catch (error) {
      console.error("Error loading contact:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os dados do contato",
        variant: "destructive",
      });
    }
  }, [selectedConversation]);

  // SHARED INBOX – Abrir modal de renomear título (cliente/grupo)
  const openRenameTitle = useCallback(() => {
    if (!selectedConversation) return;
    setRenameValue(
      getDisplayTitle(
        selectedConversation.customTitle,
        selectedConversation.contactName,
      ),
    );
    setIsRenameOpen(true);
  }, [selectedConversation]);

  // SHARED INBOX – Salvar novo título via PATCH /contacts/rename/:phone
  const handleSaveRename = useCallback(async () => {
    if (!selectedConversation) return;
    const value = renameValue.trim();
    if (!value) {
      toast({
        title: "Título inválido",
        description: "Digite um nome para o cliente/grupo",
        variant: "destructive",
      });
      return;
    }

    setIsRenaming(true);
    try {
      await contactsService.rename(selectedConversation.contactPhone, value);

      // Atualizar localmente: conversa aberta + lista lateral
      setSelectedConversation((prev) =>
        prev ? { ...prev, customTitle: value, contactName: value } : prev,
      );
      setConversations((prev) =>
        prev.map((c) =>
          c.contactPhone === selectedConversation.contactPhone
            ? { ...c, customTitle: value, contactName: value }
            : c,
        ),
      );

      toast({
        title: "Título atualizado",
        description: `O chat agora aparece como "${value}"`,
      });
      setIsRenameOpen(false);
    } catch (error) {
      toast({
        title: "Erro ao renomear",
        description:
          error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsRenaming(false);
    }
  }, [renameValue, selectedConversation]);

  // Salvar alterações do contato
  const handleSaveContact = useCallback(async () => {
    if (!selectedConversation) return;

    setIsSavingContact(true);
    try {
      const updateData = {
        name: editContactName.trim(),
        cpf: editContactCpf.trim() || undefined,
        contract: editContactContract.trim() || undefined,
        isCPC: editContactIsCPC,
      };

      if (editingContact) {
        await contactsService.updateByPhone(
          selectedConversation.contactPhone,
          updateData,
        );
      } else {
        // Criar contato se não existir
        await contactsService.create({
          name: editContactName.trim(),
          phone: selectedConversation.contactPhone,
          cpf: editContactCpf.trim() || undefined,
          contract: editContactContract.trim() || undefined,
          isCPC: editContactIsCPC,
          segment: user?.segmentId,
        });
      }

      // Atualizar nome na conversa selecionada
      if (editContactName.trim() !== selectedConversation.contactName) {
        setSelectedConversation((prev) =>
          prev
            ? {
              ...prev,
              contactName: editContactName.trim(),
            }
            : null,
        );

        // Atualizar na lista de conversas
        setConversations((prev) =>
          prev.map((c) =>
            c.contactPhone === selectedConversation.contactPhone
              ? { ...c, contactName: editContactName.trim() }
              : c,
          ),
        );
      }

      playSuccessSound();
      toast({
        title: "Contato atualizado",
        description: editContactIsCPC
          ? "Contato marcado como CPC"
          : "Dados salvos com sucesso",
      });
      setIsEditContactOpen(false);
    } catch (error) {
      playErrorSound();
      toast({
        title: "Erro ao salvar",
        description:
          error instanceof Error ? error.message : "Erro ao salvar contato",
        variant: "destructive",
      });
    } finally {
      setIsSavingContact(false);
    }
  }, [
    selectedConversation,
    editingContact,
    editContactName,
    editContactCpf,
    editContactContract,
    editContactIsCPC,
    user,
    playSuccessSound,
    playErrorSound,
  ]);

  // Carregar templates e informações do segmento
  const loadTemplates = useCallback(async () => {
    try {
      setIsLoadingTemplates(true);
      const data = await templatesService.list({ segmentId: user?.segmentId });
      setTemplates(data);

      // Carregar informações do segmento para verificar allowsFreeMessage
      if (user?.segmentId) {
        try {
          const segment = await segmentsService.getById(user.segmentId);
          setSegmentAllowsFreeMessage(segment.allowsFreeMessage ?? true);
          setSegmentDuploCpcEnabled(segment.duploCpcEnabled ?? false);
        } catch (error) {
          console.error("Error loading segment info:", error);
          // Se não conseguir carregar, assume true (permite mensagens livres)
          setSegmentAllowsFreeMessage(true);
          setSegmentDuploCpcEnabled(false);
        }
      } else {
        setSegmentAllowsFreeMessage(true);
        setSegmentDuploCpcEnabled(false);
      }
    } catch (error) {
      console.error("Error loading templates:", error);
    } finally {
      setIsLoadingTemplates(false);
    }
  }, [user?.segmentId]);

  useEffect(() => {
    loadConversations();
    loadTabulations();
    loadTemplates();
  }, [loadConversations, loadTabulations, loadTemplates]);

  // Detectar desconexão do WebSocket e sugerir atualização
  useEffect(() => {
    if (!isRealtimeConnected) {
      // Mostrar toast informando sobre desconexão após 5 segundos
      const timeout = setTimeout(() => {
        toast({
          title: "Conexão perdida",
          description:
            "A conexão com o servidor foi perdida. Atualize a página para reconectar.",
          variant: "destructive",
          duration: 10000,
          action: (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Atualizar
            </Button>
          ),
        });
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [isRealtimeConnected]);

  // Poll for new messages only if WebSocket not connected
  useEffect(() => {
    if (isRealtimeConnected) {
      console.log("[Atendimento] WebSocket connected, polling disabled");
      return;
    }

    console.log(
      "[Atendimento] WebSocket not connected, using polling fallback",
    );
    const interval = setInterval(() => {
      loadConversations();
    }, 5000);

    return () => clearInterval(interval);
  }, [loadConversations, isRealtimeConnected]);

  useEffect(() => {
    scrollToBottom();
  }, [selectedConversation?.messages]);

  // Scroll para o final quando selecionar uma conversa
  useEffect(() => {
    if (selectedConversation) {
      // Pequeno delay para garantir que o DOM foi atualizado
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [selectedConversation?.contactPhone]);

  // Função para determinar o tipo de mídia baseado no mimetype
  const getMessageTypeFromMime = (
    mimeType: string,
  ): "image" | "video" | "audio" | "document" => {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return "document";
  };

  // Função para fazer upload de arquivo
  const handleFileUpload = useCallback(
    async (file: globalThis.File) => {
      const resetFileInput = () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      };

      if (!selectedConversation || isUploadingFile) {
        resetFileInput();
        return;
      }

      // Validações de arquivo (limite alinhado à API WhatsApp)
      const ALLOWED_TYPES = [
        // Imagens
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/tiff",
        "image/svg+xml",
        "image/heic",
        "image/heif",
        // Vídeos
        "video/mp4",
        "video/mpeg",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-ms-wmv",
        "video/webm",
        "video/3gpp",
        "video/x-flv",
        "video/x-matroska",
        // Áudios
        "audio/mpeg",
        "audio/ogg",
        "audio/mp4",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
        "audio/aac",
        "audio/flac",
        "audio/x-m4a",
        // Documentos
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/rtf",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
        // Texto
        "text/plain",
        "text/csv",
        "text/html",
        "text/xml",
        "application/json",
        // Compactados
        "application/zip",
        "application/x-rar-compressed",
        "application/x-7z-compressed",
        "application/gzip",
        "application/x-tar",
      ];

      const effectiveMime = file.type || guessMimeFromFileName(file.name);

      // Validar tamanho
      if (file.size > WHATSAPP_MAX_FILE_BYTES) {
        playErrorSound();
        toast({
          title: "Arquivo não enviado",
          description:
            `O ficheiro excede o limite de ${WHATSAPP_MAX_FILE_BYTES / 1024 / 1024} MB. ` +
            `Tamanho atual: ${(file.size / 1024 / 1024).toFixed(2)} MB.`,
          variant: "destructive",
        });
        resetFileInput();
        return;
      }

      // Validar tipo (MIME reportado ou inferido pela extensão)
      if (!effectiveMime || !ALLOWED_TYPES.includes(effectiveMime)) {
        playErrorSound();
        toast({
          title: "Tipo de arquivo não permitido",
          description:
            "Use imagens, áudio, vídeo, PDF, Word, Excel, PowerPoint ou outros tipos da lista aceite.",
          variant: "destructive",
        });
        resetFileInput();
        return;
      }

      setIsUploadingFile(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const token = getAuthToken();
        if (!token) {
          throw new Error("Não autenticado");
        }

        const response = await fetch(`${API_BASE_URL}/media/upload`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const messageText =
            (await response.text().catch(() => "")) ||
            response.statusText ||
            "";
          throw new Error(
            messageText.trim().length > 0
              ? `Erro no upload (${response.status}): ${messageText.slice(0, 200)}`
              : "Erro ao fazer upload do arquivo",
          );
        }

        const data = await response.json();
        const messageType = getMessageTypeFromMime(data.mimeType);
        // Normaliza para URL absoluta antes de enviar via WebSocket —
        // assim a mensagem persiste no banco com URL pronta para uso e o
        // operador na outra ponta consegue renderizar sem novos prefixos.
        const mediaUrl = resolveMediaUrl(data.mediaUrl) ?? data.mediaUrl;

        const caption = message.trim();
        const outboundText =
          caption ||
          (messageType === "document"
            ? file.name
            : messageType === "image"
              ? "Imagem enviada"
              : messageType === "video"
                ? "Vídeo enviado"
                : messageType === "audio"
                  ? "Áudio enviado"
                  : "Documento enviado");

        // Enviar mensagem com mídia via WebSocket
        if (isRealtimeConnected) {
          realtimeSocket.send("send-message", {
            contactPhone: selectedConversation.contactPhone,
            message: outboundText,
            messageType,
            mediaUrl,
            fileName: data.originalName || data.fileName, // Incluir nome do arquivo para documentos
            isAdminTest: isAdminTestMode && user?.role === "admin",
          });
        } else {
          // Fallback: salvar via REST API
          await conversationsService.create({
            contactName: selectedConversation.contactName,
            contactPhone: selectedConversation.contactPhone,
            message: outboundText,
            sender: "operator",
            messageType,
            mediaUrl,
            fileName: file.name,
            userName: user?.name,
            userLine: user?.lineId,
            segment: user?.segmentId,
          });
        }

        setMessage(""); // Limpar input
        // NÃO mostrar toast de sucesso aqui - aguardar confirmação via WebSocket (event 'message-sent')
        // Isso garante que a mensagem realmente foi processada e aparece no chat
      } catch (error) {
        console.error("Erro ao fazer upload:", error);
        playErrorSound();
        toast({
          title: "Erro ao enviar arquivo",
          description:
            error instanceof Error ? error.message : "Erro desconhecido",
          variant: "destructive",
        });
      } finally {
        setIsUploadingFile(false);
        resetFileInput();
      }
    },
    [
      selectedConversation,
      isUploadingFile,
      isRealtimeConnected,
      message,
      user,
      isAdminTestMode,
      playErrorSound,
      toast,
    ],
  );

  // Handler para seleção de arquivo
  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.target;
      const file = input.files?.[0];
      if (!file) {
        input.value = "";
        return;
      }
      void handleFileUpload(file);
    },
    [handleFileUpload],
  );

  const openAttachmentPicker = useCallback(() => {
    const input = fileInputRef.current;
    if (input) input.value = "";
    input?.click();
  }, []);

  const handleSendMessage = useCallback(async () => {
    // Prevenir múltiplos cliques
    if (!message.trim() || !selectedConversation || isSending) {
      return;
    }

    setIsSending(true);
    const messageText = message.trim();
    setMessage(""); // Limpar input imediatamente para UX

    try {
      // Usar WebSocket para enviar mensagem via WhatsApp (se conectado)
      if (isRealtimeConnected) {
        console.log("[Atendimento] Enviando mensagem via WebSocket...", {
          isAdminTestMode,
        });
        realtimeSocket.send("send-message", {
          contactPhone: selectedConversation.contactPhone,
          message: messageText,
          messageType: "text",
          isAdminTest: isAdminTestMode && user?.role === "admin",
        });

        // A resposta virá via evento 'message-sent' (sucesso) ou 'message-error' (erro)
        // O isSending será resetado quando receber a confirmação, não aqui no finally
        // Não mostrar sucesso imediatamente - aguardar confirmação
      } else {
        // Fallback: Usar REST API (apenas salva no banco, não envia via WhatsApp)
        console.log(
          "[Atendimento] WebSocket não conectado, salvando via REST...",
        );
        await conversationsService.create({
          contactName: selectedConversation.contactName,
          contactPhone: selectedConversation.contactPhone,
          message: messageText,
          sender: "operator",
          messageType: "text",
          userName: user?.name,
          userLine: user?.lineId,
          segment: user?.segmentId,
        });

        playSuccessSound();
        toast({
          title: "Mensagem salva",
          description: "Mensagem salva (WebSocket desconectado)",
          variant: "default",
        });

        await loadConversations();
        setIsSending(false); // Resetar apenas no fallback (REST API)
      }
    } catch (error) {
      setMessage(messageText); // Restaurar mensagem se falhou
      setIsSending(false); // Resetar em caso de erro
      playErrorSound();
      toast({
        title: "Erro ao enviar",
        description:
          error instanceof Error ? error.message : "Erro ao enviar mensagem",
        variant: "destructive",
      });
    }
    // Não usar finally para WebSocket - o reset será feito via eventos
  }, [
    message,
    selectedConversation,
    isSending,
    user,
    isRealtimeConnected,
    isAdminTestMode,
    playSuccessSound,
    playErrorSound,
    loadConversations,
  ]);

  const handleTabulate = useCallback(
    async (tabulationId: number) => {
      if (!selectedConversation) return;

      try {
        await conversationsService.tabulate(
          selectedConversation.contactPhone,
          tabulationId,
        );
        playSuccessSound();
        toast({
          title: "Conversa tabulada",
          description: "A conversa foi tabulada com sucesso",
        });

        // Remove from active conversations
        setConversations((prev) =>
          prev.filter(
            (c) => c.contactPhone !== selectedConversation.contactPhone,
          ),
        );
        setSelectedConversation(null);
      } catch (error) {
        playErrorSound();
        toast({
          title: "Erro ao tabular",
          description:
            error instanceof Error ? error.message : "Erro ao tabular conversa",
          variant: "destructive",
        });
      }
    },
    [selectedConversation, playSuccessSound, playErrorSound],
  );

  const handleNewConversation = useCallback(async () => {
    // Prevenir múltiplos cliques
    if (isCreatingConversation) {
      return;
    }

    if (!newContactName.trim() || !newContactPhone.trim()) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e telefone são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    // Validação condicional para Duplo CPC
    if (segmentDuploCpcEnabled) {
      if (!/^\d{3}$/.test(newContactCpf.trim())) {
        toast({
          title: "CPF obrigatório",
          description: "Informe os 3 últimos dígitos do CPF (apenas números)",
          variant: "destructive",
        });
        return;
      }
      if (!newContactContract.trim()) {
        toast({
          title: "Contrato obrigatório",
          description: "Informe o número do contrato",
          variant: "destructive",
        });
        return;
      }
    }

    // Se estiver usando template, verificar variáveis
    if (selectedTemplate) {
      const requiredVars = selectedTemplate.variables || [];
      const missingVars = requiredVars.filter(
        (v) => !templateVariables[v]?.trim(),
      );
      if (missingVars.length > 0) {
        toast({
          title: "Variáveis obrigatórias",
          description: `Preencha: ${missingVars.join(", ")}`,
          variant: "destructive",
        });
        return;
      }
    } else {
      // Se não permite mensagem livre e não está usando template, bloquear
      if (!segmentAllowsFreeMessage) {
        toast({
          title: "Template obrigatório",
          description:
            "Este segmento não permite mensagens livres. Selecione um template para enviar a primeira mensagem.",
          variant: "destructive",
        });
        return;
      }
      // Se permite mensagem livre, verificar se há mensagem
      if (!newContactMessage.trim()) {
        toast({
          title: "Mensagem obrigatória",
          description:
            "Digite a mensagem que deseja enviar ou selecione um template",
          variant: "destructive",
        });
        return;
      }
    }

    setIsCreatingConversation(true);

    // Salvar valores antes de limpar
    const contactNameValue = newContactName.trim();
    const contactPhoneValue = newContactPhone.trim();
    const contactCpfValue = newContactCpf.trim();
    const contactContractValue = newContactContract.trim();
    const contactMessageValue = newContactMessage.trim();
    const selectedTemplateValue = selectedTemplate;
    const templateVariablesValue = { ...templateVariables };

    // Fechar modal imediatamente e limpar campos
    setIsNewConversationOpen(false);
    setNewContactName("");
    setNewContactPhone("");
    setNewContactCpf("");
    setNewContactContract("");
    setNewContactMessage("");
    setSelectedTemplate(null);
    setTemplateVariables({});

    // Mostrar toast de "Enviando mensagem..."
    toast({
      title: "Enviando mensagem...",
      description: "Aguarde a confirmação de envio",
    });

    try {
      if (isRealtimeConnected) {
        // Contato é criado no backend só depois de validar/normalizar o número na Evolution
        console.log("[Atendimento] Criando nova conversa via WebSocket...");

        if (selectedTemplateValue) {
          const variables = (selectedTemplateValue.variables || []).map(
            (v) => ({
              key: v,
              value: templateVariablesValue[v] || "",
            }),
          );

          realtimeSocket.send("send-message", {
            contactPhone: contactPhoneValue,
            templateId: selectedTemplateValue.id,
            templateVariables: variables,
            isNewConversation: true,
            isAdminTest: isAdminTestMode && user?.role === "admin",
            contactName: contactNameValue,
            contactCpf: contactCpfValue || undefined,
            contactContract: contactContractValue || undefined,
          });
        } else {
          realtimeSocket.send("send-message", {
            contactPhone: contactPhoneValue,
            message: contactMessageValue,
            messageType: "text",
            isNewConversation: true,
            isAdminTest: isAdminTestMode && user?.role === "admin",
            contactName: contactNameValue,
            contactCpf: contactCpfValue || undefined,
            contactContract: contactContractValue || undefined,
          });
        }

        // O sucesso/erro será mostrado quando receber 'message-sent' ou 'message-error'
      } else {
        // Offline: criar contato e salvar conversa no banco
        try {
          await contactsService.create({
            name: contactNameValue,
            phone: contactPhoneValue,
            cpf: contactCpfValue || undefined,
            contract: contactContractValue || undefined,
            segment: user.segmentId,
          });
        } catch (error) {
          console.warn(
            "Contato possivelmente já existe, continuando com envio...",
            error,
          );
        }
        // Fallback: Apenas salvar no banco
        await conversationsService.create({
          contactName: contactNameValue,
          contactPhone: contactPhoneValue,
          message: `Olá ${contactNameValue}, tudo bem?`,
          sender: "operator",
          messageType: "text",
          userName: user.name,
          userLine: user.lineId,
          segment: user.segmentId,
        });

        playSuccessSound();
        toast({
          title: "Conversa salva",
          description: "Salvo no sistema (WhatsApp não enviado - offline)",
          variant: "default",
        });

        await loadConversations();
        setIsCreatingConversation(false);
      }
      // Se usar WebSocket, o isCreatingConversation será resetado quando receber 'message-sent' ou 'message-error'
      // Não resetar aqui no finally para não interferir com o fluxo do WebSocket
    } catch (error) {
      // Erro ao criar contato ou enviar (fallback REST)
      setIsCreatingConversation(false);
      playErrorSound();
      toast({
        title: "Erro ao criar conversa",
        description:
          error instanceof Error ? error.message : "Erro ao criar conversa",
        variant: "destructive",
      });
    }
  }, [
    newContactName,
    newContactPhone,
    newContactCpf,
    newContactContract,
    newContactMessage,
    user,
    isRealtimeConnected,
    playSuccessSound,
    playErrorSound,
    loadConversations,
    selectedTemplate,
    templateVariables,
    isCreatingConversation,
    segmentAllowsFreeMessage,
  ]);

  // Quando selecionar template no modal, preencher nome automaticamente
  useEffect(() => {
    if (selectedTemplate && newContactName.trim()) {
      const vars = selectedTemplate.variables || [];
      const newVars: Record<string, string> = {};

      vars.forEach((v) => {
        if (v.toLowerCase() === "nome" && newContactName.trim()) {
          newVars[v] = newContactName.trim();
        } else {
          newVars[v] = templateVariables[v] || "";
        }
      });

      setTemplateVariables(newVars);
    }
  }, [selectedTemplate, newContactName]);

  const withinWhatsAppEditWindowFrontend = (datetime: string) =>
    Date.now() - new Date(datetime).getTime() <= 15 * 60 * 1000;

  const canUseOperatorMessageActions =
    user?.role === "operator" ||
    user?.role === "admin" ||
    user?.role === "supervisor";

  const openOperatorMessageEdit = (msg: ChatRow) => {
    if (!messageHasWaMessageId(msg)) {
      toast({
        title: "Não é possível editar",
        description:
          "Esta mensagem não tem ID do WhatsApp (mensagem antiga). Só é possível apagar para mim.",
        variant: "destructive",
      });
      return;
    }
    setOperatorEditMessage(msg);
    setOperatorEditText(msg.message ?? "");
    setOperatorEditOpen(true);
  };

  const handleOperatorMessageDelete = async (
    msg: ChatRow,
    scope: "me" | "everyone",
  ) => {
    try {
      setOperatorMessageActionId(msg.id);
      const updated = await conversationsService.operatorDeleteMessage(
        msg.id,
        scope,
      );
      const row = withReactions(updated);
      const phone = msg.contactPhone;
      setConversations((prev) =>
        prev.map((g) =>
          g.contactPhone !== phone
            ? g
            : {
                ...g,
                messages: g.messages.map((m) => (m.id === row.id ? row : m)),
              },
        ),
      );
      setSelectedConversation((prev) => {
        if (!prev || prev.contactPhone !== phone) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === row.id ? row : m)),
        };
      });
      toast({
        title:
          scope === "everyone"
            ? "Mensagem apagada para todos"
            : "Mensagem removida da sua visão",
      });
    } catch (e: unknown) {
      if (e instanceof ApiRequestError) {
        console.error("[Atendimento] operator-message/delete", e.status, e.data);
      }
      const desc =
        e instanceof Error
          ? e.message
          : "Não foi possível apagar a mensagem.";
      toast({ title: "Erro", description: desc, variant: "destructive" });
    } finally {
      setOperatorMessageActionId(null);
    }
  };

  const submitOperatorMessageEdit = async () => {
    if (!operatorEditMessage) return;
    const text = operatorEditText.trim();
    if (!text) {
      toast({
        title: "Texto vazio",
        description: "Digite o novo texto da mensagem.",
        variant: "destructive",
      });
      return;
    }
    try {
      setOperatorEditSaving(true);
      const updated = await conversationsService.operatorEditMessage(
        operatorEditMessage.id,
        text,
      );
      const row = withReactions(updated);
      const phone = operatorEditMessage.contactPhone;
      setConversations((prev) =>
        prev.map((g) =>
          g.contactPhone !== phone
            ? g
            : {
                ...g,
                messages: g.messages.map((m) => (m.id === row.id ? row : m)),
              },
        ),
      );
      setSelectedConversation((prev) => {
        if (!prev || prev.contactPhone !== phone) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) => (m.id === row.id ? row : m)),
        };
      });
      setOperatorEditOpen(false);
      setOperatorEditMessage(null);
      toast({ title: "Mensagem editada" });
    } catch (e: unknown) {
      if (e instanceof ApiRequestError) {
        console.error("[Atendimento] operator-message/edit", e.status, e.data);
      }
      const desc =
        e instanceof Error
          ? e.message
          : "Não foi possível editar a mensagem.";
      toast({ title: "Erro", description: desc, variant: "destructive" });
    } finally {
      setOperatorEditSaving(false);
    }
  };

  const formatTime = (datetime: string) => {
    try {
      return format(new Date(datetime), "HH:mm");
    } catch {
      return "";
    }
  };

  /** Horário/data na listagem lateral: hoje → HH:mm, ontem → "Ontem", semana → dia da semana, mais antigo → dd/MM/yy. */
  const formatChatListTime = (datetime: string) => {
    try {
      const d = new Date(datetime);
      const today = new Date();
      if (isToday(d)) return format(d, "HH:mm");
      if (isYesterday(d)) return "Ontem";
      const daysDiff = differenceInCalendarDays(today, d);
      if (daysDiff <= 7) {
        const weekday = format(d, "EEEE", { locale: ptBR }).replace(
          /-feira$/,
          "",
        );
        return weekday.charAt(0).toUpperCase() + weekday.slice(1);
      }
      return format(d, "dd/MM/yy");
    } catch {
      return "";
    }
  };

  /** Rótulo do dia para o balão separador: Hoje, Ontem, dia da semana, ou "Quarta, 4 de Fev". */
  const formatDateLabel = (datetime: string) => {
    try {
      const d = new Date(datetime);
      const today = new Date();
      if (isToday(d)) return "Hoje";
      if (isYesterday(d)) return "Ontem";
      const daysDiff = differenceInCalendarDays(today, d);
      if (daysDiff <= 7) {
        const weekday = format(d, "EEEE", { locale: ptBR }).replace(
          /-feira$/,
          "",
        );
        return weekday.charAt(0).toUpperCase() + weekday.slice(1);
      }
      const parts = format(d, "EEEE, d 'de' MMM", { locale: ptBR })
        .replace(/-feira/g, "")
        .split(" de ");
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).replace(/\.$/, ""))
        .join(" de ");
    } catch {
      return "";
    }
  };

  /** Retorna itens da lista de chat intercalando balões de data e mensagens. */
  const getChatListItems = (messages: ChatRow[]) => {
    const items: (
      | { type: "date"; label: string }
      | { type: "message"; msg: ChatRow }
    )[] = [];
    let lastDateKey = "";
    for (const msg of messages) {
      const d = new Date(msg.datetime);
      const dateKey = format(d, "yyyy-MM-dd");
      if (dateKey !== lastDateKey) {
        lastDateKey = dateKey;
        items.push({ type: "date", label: formatDateLabel(msg.datetime) });
      }
      items.push({ type: "message", msg });
    }
    return items;
  };

  return (
    <MainLayout>
      {/*
        Container raiz da página.
        Layout:
          - Mobile (< md): coluna única em h-full. A lista de conversas e
            o chat ocupam o espaço inteiro, alternando via classes
            `hidden md:flex` controladas por `selectedConversation`.
          - Desktop (md+): 2 colunas lado a lado (lista 320px + chat fluido).
            A lista pode ser recolhida via "Modo foco" (`isDesktopSidebarOpen`).
        `h-full` herda a altura do `<main>` do MainLayout, que já garante
        `h-[100dvh]` no container externo — fim do bug do teclado sumindo
        atrás do chat.
      */}
      <div className="h-full flex flex-col md:flex-row gap-2 md:gap-4 min-h-0">
        {/* Conversations List */}
        <GlassCard
          className={cn(
            "flex-col w-full md:w-80 md:flex-shrink-0 min-h-0",
            // Mobile XOR: esconder a lista quando uma conversa estiver aberta
            selectedConversation ? "hidden md:flex" : "flex",
            // Desktop: modo foco recolhe a sidebar lateral
            !isDesktopSidebarOpen && "md:hidden",
          )}
          padding="none"
        >
          {/* Header */}
          <div className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-foreground">Atendimentos</h2>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${isRealtimeConnected
                          ? "bg-success/10 text-success"
                          : "bg-muted text-muted-foreground"
                          }`}
                      >
                        {isRealtimeConnected ? (
                          <Wifi className="h-3 w-3" />
                        ) : (
                          <WifiOff className="h-3 w-3" />
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      {isRealtimeConnected
                        ? "Conectado em tempo real"
                        : "WebSocket desconectado - Atualize a página"}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.location.reload()}
                className="h-8 w-8 p-0"
                title="Atualizar página"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Dialog
                open={isNewConversationOpen}
                onOpenChange={(open) => {
                  if (!isCreatingConversation) {
                    setIsNewConversationOpen(open);
                    if (!open) {
                      // Limpar estados ao fechar
                      setIsCreatingConversation(false);
                      setSelectedTemplate(null);
                      setTemplateVariables({});
                    }
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button size="icon" className="h-8 w-8">
                    <Plus className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Nova Conversa</DialogTitle>
                    <DialogDescription>
                      Inicie uma nova conversa com um contato
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome *</Label>
                      <Input
                        id="name"
                        placeholder="Nome do contato"
                        value={newContactName}
                        onChange={(e) => setNewContactName(e.target.value)}
                        disabled={isCreatingConversation}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Telefone *</Label>
                      <Input
                        id="phone"
                        placeholder="+55 11 99999-9999"
                        value={newContactPhone}
                        onChange={(e) => setNewContactPhone(e.target.value)}
                        disabled={isCreatingConversation}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">
                        {segmentDuploCpcEnabled ? "Últimos 3 dígitos do CPF *" : "CPF"}
                      </Label>
                      <Input
                        id="cpf"
                        placeholder={segmentDuploCpcEnabled ? "Ex: 123" : "000.000.000-00"}
                        maxLength={segmentDuploCpcEnabled ? 3 : undefined}
                        value={newContactCpf}
                        onChange={(e) => {
                          const val = segmentDuploCpcEnabled
                            ? e.target.value.replace(/\D/g, '').slice(0, 3)
                            : e.target.value;
                          setNewContactCpf(val);
                        }}
                        disabled={isCreatingConversation}
                      />
                      {segmentDuploCpcEnabled && (
                        <p className="text-xs text-muted-foreground">
                          Obrigatório para este segmento (validação CPC)
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contract">
                        {segmentDuploCpcEnabled ? "Contrato *" : "Contrato"}
                      </Label>
                      <Input
                        id="contract"
                        placeholder="Número do contrato"
                        value={newContactContract}
                        onChange={(e) => setNewContactContract(e.target.value)}
                        disabled={isCreatingConversation}
                      />
                      {segmentDuploCpcEnabled && (
                        <p className="text-xs text-muted-foreground">
                          Obrigatório para este segmento (validação CPC)
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="template">Template (opcional)</Label>
                      <Select
                        value={selectedTemplate?.id.toString() || undefined}
                        onValueChange={(value) => {
                          if (value === "none") {
                            setSelectedTemplate(null);
                            setTemplateVariables({});
                            setNewContactMessage("");
                          } else {
                            const template = templates.find(
                              (t) => t.id.toString() === value,
                            );
                            setSelectedTemplate(template || null);
                            setNewContactMessage(""); // Limpar mensagem quando selecionar template
                          }
                        }}
                        disabled={isLoadingTemplates || isCreatingConversation}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              isLoadingTemplates
                                ? "Carregando..."
                                : "Selecione um template (opcional)"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Mensagem normal</SelectItem>
                          {templates.map((template) => (
                            <SelectItem
                              key={template.id}
                              value={template.id.toString()}
                            >
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Campos de Variáveis do Template */}
                    {selectedTemplate &&
                      selectedTemplate.variables &&
                      selectedTemplate.variables.length > 0 && (
                        <div className="space-y-2 p-3 bg-muted/50 rounded-lg border">
                          <Label className="text-sm font-medium">
                            Preencha as variáveis:
                          </Label>
                          {selectedTemplate.variables.map((varName) => (
                            <div key={varName} className="space-y-1">
                              <Label
                                htmlFor={`new-var-${varName}`}
                                className="text-xs"
                              >
                                {varName}:
                              </Label>
                              <Input
                                id={`new-var-${varName}`}
                                placeholder={`Valor para ${varName}`}
                                value={templateVariables[varName] || ""}
                                onChange={(e) =>
                                  setTemplateVariables((prev) => ({
                                    ...prev,
                                    [varName]: e.target.value,
                                  }))
                                }
                                className="h-8"
                                disabled={isCreatingConversation}
                              />
                            </div>
                          ))}
                          <p className="text-xs text-muted-foreground mt-2">
                            Preview:{" "}
                            {selectedTemplate.bodyText.replace(
                              /\{\{(\w+)\}\}/g,
                              (match, varName) => {
                                return templateVariables[varName] || match;
                              },
                            )}
                          </p>
                        </div>
                      )}

                    {/* Input de Mensagem - Habilitado apenas se o segmento permitir mensagens livres */}
                    {!selectedTemplate && segmentAllowsFreeMessage && (
                      <div className="space-y-2">
                        <Label htmlFor="message">Mensagem *</Label>
                        <Input
                          id="message"
                          placeholder="Digite sua mensagem..."
                          value={newContactMessage}
                          onChange={(e) => setNewContactMessage(e.target.value)}
                          disabled={isCreatingConversation}
                        />
                      </div>
                    )}
                    {!selectedTemplate && !segmentAllowsFreeMessage && (
                      <div className="space-y-2">
                        <Label htmlFor="message">Mensagem</Label>
                        <Input
                          id="message"
                          placeholder="Selecione um template para enviar a primeira mensagem"
                          value={newContactMessage}
                          onChange={(e) => setNewContactMessage(e.target.value)}
                          disabled={true}
                        />
                        <p className="text-xs text-muted-foreground">
                          Este segmento não permite mensagens livres. Selecione
                          um template para enviar a primeira mensagem.
                        </p>
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsNewConversationOpen(false);
                        setSelectedTemplate(null);
                        setTemplateVariables({});
                        setIsCreatingConversation(false);
                      }}
                      disabled={isCreatingConversation}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleNewConversation}
                      disabled={
                        isCreatingConversation ||
                        (!selectedTemplate &&
                          (!segmentAllowsFreeMessage ||
                            !newContactMessage.trim())) ||
                        (segmentDuploCpcEnabled && (
                          !/^\d{3}$/.test(newContactCpf.trim()) ||
                          !newContactContract.trim()
                        ))
                      }
                    >
                      {isCreatingConversation ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Enviando...
                        </>
                      ) : selectedTemplate ? (
                        "Enviar Template"
                      ) : segmentAllowsFreeMessage ? (
                        "Enviar Mensagem"
                      ) : (
                        "Selecione um Template"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            {/* Filtros estilo WhatsApp Web */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  ["all", "Todas"],
                  ["unread", "Não lidas"],
                  ["favorites", "Favoritas"],
                  ["groups", "Grupos"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setConversationFilter(key)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    conversationFilter === key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/80 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversations */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : displayedConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <MessageCircle className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">Nenhuma conversa neste filtro</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {displayedConversations.map((conv) => (
                  <button
                    key={conv.contactPhone}
                    onClick={() => handleSelectConversation(conv)}
                    className={cn(
                      "w-full p-3 rounded-xl text-left transition-colors",
                      "hover:bg-primary/5",
                      selectedConversation?.contactPhone ===
                      conv.contactPhone && "bg-primary/10",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <ContactAvatar
                        profilePicUrl={conv.profilePicUrl}
                        contactName={conv.contactName}
                        customTitle={conv.customTitle}
                        isGroup={conv.isGroup}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="font-medium text-sm text-foreground truncate">
                            {getDisplayTitle(conv.customTitle, conv.contactName)}
                          </p>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {conv.isPinned && (
                              <Pin
                                className="h-3 w-3 text-muted-foreground rotate-45"
                                aria-label="Conversa fixada"
                              />
                            )}
                            <span className="text-xs text-muted-foreground">
                              {formatChatListTime(conv.lastMessageTime)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {conv.isFromContact ? (
                            <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ArrowRight className="h-3 w-3 text-primary" />
                          )}
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.lastMessage}
                          </p>
                        </div>
                      </div>
                      {(conv.unreadCount ?? 0) > 0 && (
                        <div className="min-w-[1.25rem] h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-1">
                          {(conv.unreadCount ?? 0) > 99
                            ? "99+"
                            : conv.unreadCount}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </GlassCard>

        {/* Chat Area */}
        <GlassCard
          className={cn(
            "flex-1 flex-col min-h-0 w-full",
            // Mobile XOR: esconder o chat quando nenhuma conversa está aberta
            selectedConversation ? "flex" : "hidden md:flex",
          )}
          padding="none"
        >
          {selectedConversation ? (
            <>
              {/* Chat Header */}
              <div className="p-3 md:p-4 border-b border-border/50 flex items-center justify-between gap-2 flex-shrink-0">
                <div className="flex items-center gap-2 md:gap-3 min-w-0">
                  {/*
                    Botão de voltar — só aparece no mobile. Como no mobile a
                    lista de conversas é ocultada quando há um chat aberto,
                    precisamos de um caminho explícito para "voltar". Limpa
                    `selectedConversation` e a UI volta automaticamente para
                    a lista (graças ao XOR `selectedConversation ? : `).
                  */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 md:hidden flex-shrink-0"
                    onClick={() => setSelectedConversation(null)}
                    aria-label="Voltar para a lista"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 hidden md:flex flex-shrink-0"
                          onClick={() =>
                            setIsDesktopSidebarOpen((prev) => !prev)
                          }
                          aria-label={
                            isDesktopSidebarOpen
                              ? "Recolher lista de conversas"
                              : "Mostrar lista de conversas"
                          }
                        >
                          {isDesktopSidebarOpen ? (
                            <PanelLeftClose className="h-5 w-5" />
                          ) : (
                            <PanelLeftOpen className="h-5 w-5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isDesktopSidebarOpen
                          ? "Modo foco: recolher conversas"
                          : "Mostrar lista de conversas"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <ContactAvatar
                    profilePicUrl={selectedConversation.profilePicUrl}
                    contactName={selectedConversation.contactName}
                    customTitle={selectedConversation.customTitle}
                    isGroup={selectedConversation.isGroup}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">
                      {getDisplayTitle(
                        selectedConversation.customTitle,
                        selectedConversation.contactName,
                      )}
                    </p>
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-xs text-muted-foreground truncate">
                        {selectedConversation.contactPhone}
                      </p>
                      {typingDisplay && (
                        <p className="text-xs text-primary italic animate-pulse truncate">
                          • {typingDisplay}
                        </p>
                      )}
                    </div>
                  </div>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={handleTogglePin}
                          disabled={isPinToggling}
                          aria-label={
                            selectedConversation.isPinned
                              ? "Desfixar conversa"
                              : "Fixar conversa"
                          }
                        >
                          {isPinToggling ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : selectedConversation.isPinned ? (
                            <PinOff className="h-4 w-4" />
                          ) : (
                            <Pin className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {selectedConversation.isPinned
                          ? "Desfixar conversa"
                          : "Fixar conversa no topo"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={openRenameTitle}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Renomear título do cliente/grupo
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={openEditContact}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Editar Contato</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="flex items-center gap-2">
                  {(user?.role === "admin" ||
                    user?.role === "digital" ||
                    user?.role === "supervisor") && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!selectedConversation) return;
                                try {
                                  // Fazer download do PDF via API
                                  const response = await fetch(
                                    `${API_BASE_URL}/conversations/download-pdf/${selectedConversation.contactPhone}`,
                                    {
                                      method: "GET",
                                      headers: {
                                        Authorization: `Bearer ${getAuthToken()}`,
                                      },
                                    },
                                  );

                                  if (!response.ok) {
                                    throw new Error("Erro ao baixar PDF");
                                  }

                                  // Criar blob do PDF e download
                                  const blob = await response.blob();
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download = `conversa-${selectedConversation.contactPhone
                                    }-${format(new Date(), "yyyy-MM-dd")}.pdf`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);

                                  toast({
                                    title: "Download iniciado",
                                    description: "Conversa baixada com sucesso",
                                  });
                                } catch (error) {
                                  toast({
                                    title: "Erro ao baixar",
                                    description:
                                      error instanceof Error
                                        ? error.message
                                        : "Erro ao baixar conversa",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Baixar PDF
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Baixar conversa em PDF
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        Tabular
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <div
                        className="p-2 border-b"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Pesquisar tabulação..."
                            value={tabulationSearch}
                            onChange={(e) =>
                              setTabulationSearch(e.target.value)
                            }
                            className="pl-8 h-8"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {tabulations
                          .filter((tab) =>
                            tab.name
                              .toLowerCase()
                              .includes(tabulationSearch.toLowerCase()),
                          )
                          .map((tab) => (
                            <DropdownMenuItem
                              key={tab.id}
                              onClick={() => handleTabulate(tab.id)}
                            >
                              {tab.name}
                            </DropdownMenuItem>
                          ))}
                        {tabulations.filter((tab) =>
                          tab.name
                            .toLowerCase()
                            .includes(tabulationSearch.toLowerCase()),
                        ).length === 0 && (
                            <DropdownMenuItem disabled>
                              {tabulationSearch
                                ? "Nenhuma tabulação encontrada"
                                : "Nenhuma tabulação disponível"}
                            </DropdownMenuItem>
                          )}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* SHARED INBOX – Modal de Renomear Título (cliente/grupo) */}
              <Dialog open={isRenameOpen} onOpenChange={setIsRenameOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Renomear cliente/grupo</DialogTitle>
                    <DialogDescription>
                      O título será aplicado no Shared Inbox e travado contra
                      sobrescritas automáticas da Evolution API.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="rename-title">Nome do Cliente/Grupo</Label>
                    <Input
                      id="rename-title"
                      placeholder="Ex.: Loja Central — Maria"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isRenaming) handleSaveRename();
                      }}
                      autoFocus
                      maxLength={120}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsRenameOpen(false)}
                      disabled={isRenaming}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveRename} disabled={isRenaming}>
                      {isRenaming ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Modal de Edição de Contato */}
              <Dialog
                open={isEditContactOpen}
                onOpenChange={setIsEditContactOpen}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Editar Contato</DialogTitle>
                    <DialogDescription>
                      Edite as informações do contato
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-name">Nome</Label>
                      <Input
                        id="edit-name"
                        placeholder="Nome do contato"
                        value={editContactName}
                        onChange={(e) => setEditContactName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-cpf">CPF</Label>
                      <Input
                        id="edit-cpf"
                        placeholder="000.000.000-00"
                        value={editContactCpf}
                        onChange={(e) => setEditContactCpf(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-contract">Contrato</Label>
                      <Input
                        id="edit-contract"
                        placeholder="Número do contrato"
                        value={editContactContract}
                        onChange={(e) => setEditContactContract(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <Label className="text-base font-medium">
                          Marcar como CPC
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Contato foi contatado com sucesso
                        </p>
                      </div>
                      <Switch
                        checked={editContactIsCPC}
                        onCheckedChange={setEditContactIsCPC}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsEditContactOpen(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleSaveContact}
                      disabled={isSavingContact}
                    >
                      {isSavingContact ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={operatorEditOpen}
                onOpenChange={(open) => {
                  setOperatorEditOpen(open);
                  if (!open) {
                    setOperatorEditMessage(null);
                    setOperatorEditText("");
                  }
                }}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Editar mensagem</DialogTitle>
                    <DialogDescription>
                      O texto é atualizado no WhatsApp e no histórico (regra de
                      até 15 minutos da API).
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="operator-edit-msg">Novo texto</Label>
                    <Textarea
                      id="operator-edit-msg"
                      value={operatorEditText}
                      onChange={(e) => setOperatorEditText(e.target.value)}
                      rows={4}
                      className="resize-y min-h-[100px]"
                      disabled={operatorEditSaving}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setOperatorEditOpen(false);
                        setOperatorEditMessage(null);
                      }}
                      disabled={operatorEditSaving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void submitOperatorMessageEdit()}
                      disabled={operatorEditSaving}
                    >
                      {operatorEditSaving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Messages */}
              <ScrollArea ref={messagesScrollRef} className="flex-1 p-4">
                <div className="space-y-4">
                  {getChatListItems(selectedConversation.messages).map(
                    (item, index) =>
                      item.type === "date" ? (
                        <div
                          key={`date-${index}-${item.label}`}
                          className="flex justify-center py-1"
                        >
                          <span className="rounded-full bg-muted/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm">
                            {item.label}
                          </span>
                        </div>
                      ) : item.msg.messageType === "reaction" ? (
                        <div
                          key={item.msg.id}
                          className="flex justify-center py-1"
                        >
                          <div className="rounded-full border border-border/60 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                            {renderTextWithLinks(
                              item.msg.message?.trim() || "Reação",
                              handlePhoneClick,
                              item.msg.sender === "operator",
                            )}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={item.msg.id}
                          className={cn(
                            "flex gap-2",
                            item.msg.sender === "contact"
                              ? "justify-start"
                              : "justify-end",
                          )}
                        >
                          {item.msg.sender === "contact" && (
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-medium">
                                {selectedConversation.contactName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 2)}
                              </span>
                            </div>
                          )}
                          <div
                            className={cn(
                              // Mobile: balões mais largos (85%) para
                              // aproveitar a tela estreita; desktop mantém
                              // 70%. `break-words` + `whitespace-pre-wrap`
                              // garantem que URLs longas / mensagens sem
                              // espaços quebrem em vez de causar overflow
                              // horizontal.
                              "max-w-[85%] md:max-w-[70%] relative rounded-2xl px-4 py-2 break-words whitespace-pre-wrap",
                              item.msg.sender === "contact"
                                ? "bg-card border border-border"
                                : "bg-primary text-primary-foreground",
                            )}
                          >
                            {/* SHARED INBOX – Autoria do operador (Quem do time enviou) */}
                            {item.msg.sender === "operator" &&
                              item.msg.userName && (
                                <p className="text-[11px] font-semibold mb-1 opacity-90">
                                  {item.msg.userName}
                                </p>
                              )}
                            {/* SHARED INBOX – Participante do grupo (quem falou) */}
                            {item.msg.sender === "contact" &&
                              item.msg.participantName && (
                                <p className="text-[11px] font-semibold mb-1 text-primary">
                                  {item.msg.participantName}
                                </p>
                              )}
                            {canUseOperatorMessageActions &&
                              !item.msg.isDeleted && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className={cn(
                                        "absolute top-1 right-1 h-7 w-7 shrink-0 opacity-70 hover:opacity-100",
                                        item.msg.sender === "operator"
                                          ? "text-primary-foreground hover:bg-primary-foreground/15"
                                          : "text-muted-foreground hover:bg-muted",
                                      )}
                                      aria-label="Ações da mensagem"
                                      disabled={
                                        operatorMessageActionId === item.msg.id
                                      }
                                    >
                                      {operatorMessageActionId ===
                                      item.msg.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <MoreVertical className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="w-52"
                                  >
                                    {item.msg.sender === "operator" &&
                                      item.msg.messageType === "text" &&
                                      messageHasWaMessageId(item.msg) &&
                                      withinWhatsAppEditWindowFrontend(
                                        item.msg.datetime,
                                      ) &&
                                      (user?.role === "admin" ||
                                        user?.role === "supervisor" ||
                                        (user?.role === "operator" &&
                                          item.msg.userId === user?.id)) && (
                                        <DropdownMenuItem
                                          onClick={() =>
                                            openOperatorMessageEdit(item.msg)
                                          }
                                        >
                                          <Pencil className="mr-2 h-4 w-4" />
                                          Editar
                                        </DropdownMenuItem>
                                      )}
                                    <DropdownMenuItem
                                      onClick={() =>
                                        handleOperatorMessageDelete(
                                          item.msg,
                                          "me",
                                        )
                                      }
                                    >
                                      Apagar para mim
                                    </DropdownMenuItem>
                                    {item.msg.sender === "operator" &&
                                      messageHasWaMessageId(item.msg) &&
                                      (user?.role === "admin" ||
                                        user?.role === "supervisor" ||
                                        (user?.role === "operator" &&
                                          item.msg.userId === user?.id)) && (
                                        <DropdownMenuItem
                                          onClick={() =>
                                            handleOperatorMessageDelete(
                                              item.msg,
                                              "everyone",
                                            )
                                          }
                                        >
                                          Apagar para todos
                                        </DropdownMenuItem>
                                      )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            {/* Renderizar mídia baseado no messageType.
                                Todas as URLs passam por resolveMediaUrl,
                                que devolve absoluta/relativa+API_BASE_URL/
                                data:URI conforme o caso — eliminando o
                                bug de "imagem quebrada no F5".
                                Stickers usam <img> em tamanho reduzido. */}
                            {item.msg.isDeleted ? (
                              <div
                                className={cn(
                                  "flex items-center gap-2 text-sm italic pr-8",
                                  item.msg.sender === "contact"
                                    ? "text-muted-foreground"
                                    : "opacity-90",
                                )}
                              >
                                <LockIcon
                                  className="h-4 w-4 shrink-0"
                                  aria-hidden
                                />
                                <span>🚫 Mensagem apagada</span>
                              </div>
                            ) : (
                            <>
                            {(() => {
                              const resolvedUrl = resolveMediaUrl(
                                item.msg.mediaUrl,
                              );
                              const onImgError = (
                                e: SyntheticEvent<HTMLImageElement>,
                              ) => {
                                // Fallback gracioso: se a URL não carregar,
                                // mostramos o balão semi-transparente em vez de
                                // um ícone de "imagem quebrada".
                                console.warn(
                                  "[Atendimento] Falha ao carregar mídia:",
                                  (e.currentTarget as HTMLImageElement).src,
                                );
                                (e.currentTarget as HTMLImageElement).style.opacity =
                                  "0.25";
                              };

                              if (
                                item.msg.messageType === "image" &&
                                resolvedUrl
                              ) {
                                return (
                                  <div className="mb-2">
                                    {createElement("img", {
                                      src: resolvedUrl,
                                      alt: "Imagem",
                                      className:
                                        "max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity",
                                      style: { maxHeight: "300px" },
                                      onClick: () =>
                                        window.open(resolvedUrl, "_blank"),
                                      onError: onImgError,
                                    })}
                                    {item.msg.message &&
                                      !item.msg.message.includes("recebida") && (
                                        <p className="text-sm mt-2">
                                          {renderTextWithLinks(
                                            item.msg.message,
                                            handlePhoneClick,
                                            item.msg.sender === "operator",
                                          )}
                                        </p>
                                      )}
                                  </div>
                                );
                              }

                              if (
                                item.msg.messageType === "sticker" &&
                                resolvedUrl
                              ) {
                                // Figurinhas: img com max-width menor para
                                // preservar a estética de sticker do WhatsApp.
                                return (
                                  <div className="mb-1">
                                    {createElement("img", {
                                      src: resolvedUrl,
                                      alt: "Figurinha",
                                      className:
                                        "rounded-md cursor-pointer hover:opacity-90 transition-opacity",
                                      style: {
                                        maxWidth: "160px",
                                        maxHeight: "160px",
                                      },
                                      onClick: () =>
                                        window.open(resolvedUrl, "_blank"),
                                      onError: onImgError,
                                    })}
                                  </div>
                                );
                              }

                              if (
                                item.msg.messageType === "audio" &&
                                resolvedUrl
                              ) {
                                return (
                                  <div className="mb-2">
                                    {createElement(
                                      "audio",
                                      {
                                        controls: true,
                                        className: "max-w-full",
                                        src: resolvedUrl,
                                      },
                                      "Seu navegador não suporta áudio.",
                                    )}
                                  </div>
                                );
                              }

                              if (
                                item.msg.messageType === "video" &&
                                resolvedUrl
                              ) {
                                return (
                                  <div className="mb-2">
                                    {createElement(
                                      "video",
                                      {
                                        controls: true,
                                        className: "max-w-full rounded-lg",
                                        style: { maxHeight: "300px" },
                                        src: resolvedUrl,
                                      },
                                      "Seu navegador não suporta vídeo.",
                                    )}
                                    {item.msg.message &&
                                      !item.msg.message.includes("recebido") && (
                                        <p className="text-sm mt-2">
                                          {renderTextWithLinks(
                                            item.msg.message,
                                            handlePhoneClick,
                                            item.msg.sender === "operator",
                                          )}
                                        </p>
                                      )}
                                  </div>
                                );
                              }

                              if (item.msg.messageType === "document") {
                                const docLabel =
                                  item.msg.message?.trim() || "Documento";
                                const downloadAttr = docLabel.replace(
                                  /[/\\?%*:|"<>]/g,
                                  "_",
                                );
                                return (
                                  <div className="mb-2">
                                    {resolvedUrl ? (
                                      <a
                                        href={resolvedUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        download={downloadAttr || undefined}
                                        className={cn(
                                          "flex items-center gap-2 text-sm underline hover:no-underline",
                                          "break-all",
                                        )}
                                      >
                                        <FileIcon className="h-4 w-4 flex-shrink-0" aria-hidden />
                                        {docLabel}
                                      </a>
                                    ) : (
                                      <span className="flex items-center gap-2 text-sm break-all opacity-80">
                                        <FileIcon className="h-4 w-4 flex-shrink-0" aria-hidden />
                                        {renderTextWithLinks(
                                          docLabel,
                                          handlePhoneClick,
                                          item.msg.sender === "operator",
                                        )}
                                      </span>
                                    )}
                                  </div>
                                );
                              }

                              // Fallback: texto puro (inclui mensagens sem mídia
                              // e casos em que `resolvedUrl` é null porque o
                              // backend descartou uma URL CDN inválida).
                              const fallbackText = item.msg.message ?? "";
                              if (!fallbackText.trim()) return null;
                              return (
                                <p className="text-sm">
                                  {renderTextWithLinks(
                                    fallbackText,
                                    handlePhoneClick,
                                    item.msg.sender === "operator",
                                  )}
                                </p>
                              );
                            })()}
                            </>
                            )}
                            {item.msg.reactions &&
                              item.msg.reactions.length > 0 && (
                                <span
                                  className="pointer-events-none absolute -bottom-2 -right-2 z-[1] rounded-full border border-border bg-background px-1.5 py-0.5 text-[11px] leading-none shadow-sm"
                                  title="Reações"
                                >
                                  {item.msg.reactions.join("")}
                                </span>
                              )}
                            <p
                              className={cn(
                                "text-xs mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5",
                                item.msg.sender === "contact"
                                  ? "text-muted-foreground"
                                  : "text-primary-foreground/70",
                              )}
                            >
                              <span>{formatTime(item.msg.datetime)}</span>
                              {item.msg.isEdited && !item.msg.isDeleted && (
                                <span className="opacity-90 whitespace-nowrap">
                                  ✏️ Editado
                                </span>
                              )}
                            </p>
                          </div>
                          {item.msg.sender === "operator" && (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-cyan flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-medium text-primary-foreground">
                                OP
                              </span>
                            </div>
                          )}
                        </div>
                      )
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Message Input */}
              {/*
                Sticky bottom + safe-area:
                  - `sticky bottom-0` fixa o input no rodapé do scroller
                    pai (o `<GlassCard>` flex-col), de modo que ele NUNCA
                    fica atrás do teclado virtual quando o usuário foca o
                    input — combinado com o `h-[100dvh]` do `MainLayout`,
                    elimina o bug do iOS/Android.
                  - `pb-[max(env(safe-area-inset-bottom),0.5rem)]` evita
                    que o botão Enviar cole no "Home Indicator" do iPhone.
                  - `bg-background` cobre qualquer conteúdo que role por
                    baixo (importante porque o GlassCard usa fundo
                    semi-transparente).
                  - `z-10` mantém o input acima de eventuais elementos
                    posicionados dentro do ScrollArea.
              */}
              <div className="p-3 md:p-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] border-t border-border/50 sticky bottom-0 bg-background/95 backdrop-blur z-10 flex-shrink-0">
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept={FILE_INPUT_ACCEPT}
                    className="hidden"
                    id="file-upload-input"
                    disabled={
                      isUploadingFile || !selectedConversation || isSending
                    }
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={openAttachmentPicker}
                    disabled={
                      isUploadingFile || !selectedConversation || isSending
                    }
                    title="Anexar ficheiro (imagem, PDF, documento, áudio ou vídeo)"
                  >
                    {isUploadingFile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                  <Input
                    placeholder="Digite sua mensagem..."
                    value={message}
                    onChange={(e) => {
                      setMessage(e.target.value);
                      emitTyping(selectedConversation?.contactPhone);
                    }}
                    onBlur={() => {
                      if (selectedConversation?.contactPhone) {
                        realtimeSocket.sendTyping(
                          selectedConversation.contactPhone,
                          false,
                        );
                      }
                    }}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !e.shiftKey && handleSendMessage()
                    }
                    className="flex-1"
                    disabled={isSending}
                  />
                  {user?.role === "admin" && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-2 mr-2">
                            <Switch
                              id="admin-test-mode"
                              checked={isAdminTestMode}
                              onCheckedChange={setIsAdminTestMode}
                              className="data-[state=checked]:bg-amber-500"
                            />
                            <Label
                              htmlFor="admin-test-mode"
                              className={cn(
                                "text-xs font-medium cursor-pointer",
                                isAdminTestMode && "text-amber-500 font-bold",
                              )}
                            >
                              🧪 Teste Admin
                            </Label>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Ativar modo teste administrador - ações não
                            aparecerão nos relatórios
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <Button
                    size="icon"
                    onClick={handleSendMessage}
                    disabled={isSending || !message.trim()}
                  >
                    {isSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageCircle className="h-16 w-16 mb-4 opacity-50" />
              <p className="text-lg font-medium">Selecione uma conversa</p>
              <p className="text-sm">
                Escolha uma conversa para começar o atendimento
              </p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Dialog de Notificação de Linha Banida */}
      <Dialog
        open={!!lineBannedNotification}
        onOpenChange={(open) => !open && setLineBannedNotification(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Linha Banida
            </DialogTitle>
            <DialogDescription>
              {lineBannedNotification?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-1">Linha banida:</p>
              <p className="text-sm text-muted-foreground">
                {lineBannedNotification?.bannedLinePhone}
              </p>
              {lineBannedNotification?.newLinePhone && (
                <>
                  <p className="text-sm font-medium mt-3 mb-1">
                    Nova linha atribuída:
                  </p>
                  <p className="text-sm text-success">
                    {lineBannedNotification.newLinePhone}
                  </p>
                </>
              )}
            </div>

            {lineBannedNotification &&
              lineBannedNotification.contactsToRecall.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-3">
                    Contatos para rechamar (
                    {lineBannedNotification.contactsToRecall.length}):
                  </p>
                  <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-2">
                      {lineBannedNotification.contactsToRecall.map(
                        (contact) => (
                          <div
                            key={contact.phone}
                            className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                {contact.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {contact.phone}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              onClick={async () => {
                                if (isRecallingContact === contact.phone)
                                  return;

                                setIsRecallingContact(contact.phone);
                                try {
                                  await conversationsService.recallContact(
                                    contact.phone,
                                  );
                                  toast({
                                    title: "✅ Contato rechamado",
                                    description: `Conversa reiniciada com ${contact.name}`,
                                  });

                                  // Recarregar conversas
                                  await loadConversations();

                                  // Selecionar a conversa recém-criada
                                  await loadConversations();
                                  // Usar setTimeout para garantir que o estado foi atualizado
                                  setTimeout(() => {
                                    setConversations((prev) => {
                                      const found = prev.find(
                                        (c) => c.contactPhone === contact.phone,
                                      );
                                      if (found) {
                                        setSelectedConversation(found);
                                      }
                                      return prev;
                                    });
                                  }, 100);

                                  // Remover da lista de contatos para rechamar
                                  setLineBannedNotification((prev) => {
                                    if (!prev) return null;
                                    const updated =
                                      prev.contactsToRecall.filter(
                                        (c) => c.phone !== contact.phone,
                                      );
                                    if (updated.length === 0) {
                                      return null; // Fechar dialog se não houver mais contatos
                                    }
                                    return {
                                      ...prev,
                                      contactsToRecall: updated,
                                    };
                                  });
                                } catch (error) {
                                  toast({
                                    title: "Erro ao rechamar contato",
                                    description:
                                      error instanceof Error
                                        ? error.message
                                        : "Erro desconhecido",
                                    variant: "destructive",
                                  });
                                } finally {
                                  setIsRecallingContact(null);
                                }
                              }}
                              disabled={
                                isRecallingContact === contact.phone ||
                                !!isRecallingContact
                              }
                            >
                              {isRecallingContact === contact.phone ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Rechamando...
                                </>
                              ) : (
                                <>
                                  <PhoneIcon className="mr-2 h-4 w-4" />
                                  Rechamar
                                </>
                              )}
                            </Button>
                          </div>
                        ),
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}

            {lineBannedNotification &&
              lineBannedNotification.contactsToRecall.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum contato para rechamar.
                </p>
              )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLineBannedNotification(null)}
            >
              Fechar
            </Button>
            {lineBannedNotification &&
              lineBannedNotification.contactsToRecall.length > 0 && (
                <Button
                  onClick={async () => {
                    // Rechamar todos os contatos
                    if (!lineBannedNotification) return;

                    const contacts = [
                      ...lineBannedNotification.contactsToRecall,
                    ];
                    for (const contact of contacts) {
                      try {
                        setIsRecallingContact(contact.phone);
                        await conversationsService.recallContact(contact.phone);
                        await new Promise((resolve) =>
                          setTimeout(resolve, 500),
                        ); // Pequeno delay entre chamadas
                      } catch (error) {
                        console.error(
                          `Erro ao rechamar ${contact.phone}:`,
                          error,
                        );
                      } finally {
                        setIsRecallingContact(null);
                      }
                    }

                    toast({
                      title: "✅ Contatos rechamados",
                      description: `${contacts.length} contato(s) rechamado(s) com sucesso`,
                    });

                    await loadConversations();
                    setLineBannedNotification(null);
                  }}
                  disabled={!!isRecallingContact}
                >
                  {isRecallingContact ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Rechamando todos...
                    </>
                  ) : (
                    <>
                      <PhoneIcon className="mr-2 h-4 w-4" />
                      Rechamar Todos
                    </>
                  )}
                </Button>
              )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
