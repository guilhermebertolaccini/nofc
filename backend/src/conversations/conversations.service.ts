import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { Role } from "@prisma/client";
import axios from "axios";
import { PrismaService } from "../prisma.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { UpdateConversationDto } from "./dto/update-conversation.dto";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { EvolutionService } from "../evolution/evolution.service";
import { extractWaMessageIdFromEvolutionSendResponse } from "../common/extract-wa-message-id";

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
    private readonly evolutionService: EvolutionService,
  ) {}

  /**
   * Alinha com `WebsocketGateway.resolveOutboundConversationMessage`:
   * não perder o nome do ficheiro quando o cliente só envia rótulo genérico de mídia.
   */
  private resolveOutboundMessageText(
    message: string,
    fileName?: string,
  ): string {
    const cap = message?.trim() ?? "";
    const generic = new Set([
      "Documento enviado",
      "Imagem enviada",
      "Vídeo enviado",
      "Áudio enviado",
    ]);
    const fn = fileName?.trim() ?? "";
    if (cap && !generic.has(cap)) return cap;
    if (fn) return fn;
    return cap || " ";
  }

  async create(createConversationDto: CreateConversationDto) {
    const { fileName, ...rest } = createConversationDto;
    const message = this.resolveOutboundMessageText(rest.message, fileName);

    return this.prisma.conversation.create({
      data: {
        ...rest,
        message,
        datetime: rest.datetime ?? new Date(),
      },
    });
  }

  /**
   * Lista conversas aplicando a Prioridade de Exibição Estrita do
   * Shared Inbox de Número Único.
   *
   * Prioridade do `contactName` retornado ao frontend:
   *   1. Contact.customTitle  (manual, travado contra Evolution)
   *   2. Contact.name         (nome real do contato)
   *   3. Conversation.contactName (snapshot gravado pelo webhook)
   *   4. "Desconhecido"
   *
   * Observação técnica: o schema NÃO declara uma relação Prisma entre
   * Conversation.contactPhone e Contact.phone (criar essa FK quebraria
   * conversations inbound de grupos/leads cujo Contact ainda não existe).
   * Por isso, em vez de `include`, fazemos um "include lógico": uma única
   * query batch em Contact e merge em memória. O resultado para o frontend
   * é equivalente — payload limpo, sem objeto relacional aninhado, com
   * `contactName` já resolvido e `customTitle` exposto no topo.
   */
  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};

    // Se houver busca por texto, aplicar filtros
    const where = search
      ? {
          ...validFilters,
          OR: [
            { contactName: { contains: search, mode: "insensitive" } },
            { contactPhone: { contains: search } },
            { message: { contains: search, mode: "insensitive" } },
          ],
        }
      : validFilters;

    console.log(
      `🔍 [ConversationsService.findAll] Filters:`,
      JSON.stringify(filters),
      `Where:`,
      JSON.stringify(where),
    );

    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: "desc",
      },
    });

    if (conversations.length === 0) {
      return [];
    }

    // Batch lookup: 1 query única buscando todos os contatos envolvidos
    const uniquePhones = Array.from(
      new Set(
        conversations
          .map((c) => c.contactPhone)
          .filter((p): p is string => !!p),
      ),
    );

    const contacts = await this.prisma.contact.findMany({
      where: { phone: { in: uniquePhones } },
      select: {
        phone: true,
        customTitle: true,
        name: true,
        isNameManual: true,
        isPinned: true,
        profilePicUrl: true,
      },
    });

    const contactsByPhone = new Map(contacts.map((c) => [c.phone, c]));

    return conversations.map((conv) =>
      this.mergeContactIntoConversation(conv, contactsByPhone.get(conv.contactPhone)),
    );
  }

  /** Enriquece mensagens com dados do Contact (nome, pin, grupo). */
  private async enrichConversationsWithContact<T extends { contactPhone: string; contactName: string; isGroup?: boolean }>(
    conversations: T[],
  ) {
    if (conversations.length === 0) return [];

    const uniquePhones = Array.from(
      new Set(
        conversations
          .map((c) => c.contactPhone)
          .filter((p): p is string => !!p),
      ),
    );

    const contacts = await this.prisma.contact.findMany({
      where: { phone: { in: uniquePhones } },
      select: {
        phone: true,
        customTitle: true,
        name: true,
        isNameManual: true,
        isPinned: true,
        profilePicUrl: true,
      },
    });

    const contactsByPhone = new Map(contacts.map((c) => [c.phone, c]));

    return conversations.map((conv) =>
      this.mergeContactIntoConversation(conv, contactsByPhone.get(conv.contactPhone)),
    );
  }

  private mergeContactIntoConversation<
    T extends { contactPhone: string; contactName: string; isGroup?: boolean },
  >(
    conv: T,
    contact?: {
      customTitle?: string | null;
      name?: string;
      isPinned?: boolean;
      profilePicUrl?: string | null;
    },
  ) {
    const contactCustomTitle = contact?.customTitle?.trim() || null;
    const contactOriginalName = contact?.name?.trim() || null;
    const snapshotName = conv.contactName?.trim() || null;

    const displayTitle =
      contactCustomTitle ||
      contactOriginalName ||
      snapshotName ||
      "Desconhecido";

    const isGroup =
      conv.isGroup === true || conv.contactPhone.includes("@g.us");

    return {
      ...conv,
      contactName: displayTitle,
      customTitle: contactCustomTitle,
      isPinned: contact?.isPinned ?? false,
      profilePicUrl: contact?.profilePicUrl?.trim() || null,
      isGroup,
    };
  }

  async findByContactPhone(
    contactPhone: string,
    tabulated: boolean = false,
    userId?: number,
  ) {
    const where: any = {
      contactPhone,
      tabulation: tabulated ? { not: null } : null,
    };

    // IMPORTANTE: Se for operador, filtrar por userId (não por userLine)
    // Isso permite que as conversas continuem aparecendo mesmo se a linha foi banida
    if (userId) {
      where.userId = userId;
    }

    return this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: "asc",
      },
    });
  }

  /**
   * Lista conversas ATIVAS (não tabuladas) visíveis para um operador.
   *
   * Shared Inbox de Número Único:
   *   Quando `opts.sharedLineMode = true`, NÃO se filtra por `userId`. Isso
   *   é fundamental porque o webhook inbound atribui `userId` para apenas
   *   UM operador (o primeiro online da linha). Sem essa flexibilização,
   *   os demais operadores ficariam sem ver mensagens de grupos e leads
   *   compartilhados — exatamente o Bug 1 que estava em produção.
   *
   *   No shared mode, o filtro coerente é por `userLine` (a linha única
   *   compartilhada) e/ou por `segment` (defesa por segmento, se aplicável).
   *
   * Modo legado:
   *   Mantém a lógica original (filtra por `userId` se fornecido, senão
   *   `userLine`). Preservado para compatibilidade com chamadas antigas
   *   que ainda não foram migradas.
   */
  async findActiveConversations(
    userLine?: number,
    userId?: number,
    opts?: { sharedLineMode?: boolean; segment?: number | null },
  ) {
    const where: any = {
      tabulation: null,
    };

    if (opts?.sharedLineMode) {
      // Shared Inbox: visibilidade pela LINHA, não pelo operador atribuído
      if (userLine) {
        where.userLine = userLine;
      }
      if (opts.segment !== undefined && opts.segment !== null) {
        where.segment = opts.segment;
      }
    } else {
      // Modo legado: prioriza userId, com fallback para userLine
      if (userId) {
        where.userId = userId;
      } else if (userLine) {
        where.userLine = userLine;
      }
    }

    // Retornar TODAS as mensagens não tabuladas (SEM LIMITE - histórico completo)
    // O frontend vai agrupar por contactPhone/groupId
    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: "asc", // Ordem cronológica para histórico
      },
      // SEM take/limit - carregar todo o histórico
    });

    return this.enrichConversationsWithContact(conversations);
  }

  /**
   * Lista conversas TABULADAS visíveis para um operador.
   * Mesma semântica de Shared Inbox descrita em `findActiveConversations`.
   */
  async findTabulatedConversations(
    userLine?: number,
    userId?: number,
    opts?: { sharedLineMode?: boolean; segment?: number | null },
  ) {
    const where: any = {
      tabulation: { not: null },
    };

    if (opts?.sharedLineMode) {
      if (userLine) {
        where.userLine = userLine;
      }
      if (opts.segment !== undefined && opts.segment !== null) {
        where.segment = opts.segment;
      }
    } else {
      if (userId) {
        where.userId = userId;
      } else if (userLine) {
        where.userLine = userLine;
      }
    }

    // Retornar TODAS as mensagens tabuladas (o frontend vai agrupar)
    const conversations = await this.prisma.conversation.findMany({
      where,
      orderBy: {
        datetime: "asc", // Ordem cronológica para histórico
      },
    });

    return this.enrichConversationsWithContact(conversations);
  }

  /**
   * Buscar conversas ativas de múltiplos operadores (modo linha compartilhada)
   */
  async findActiveConversationsByUserIds(userIds: number[]) {
    return this.prisma.conversation.findMany({
      where: {
        userId: { in: userIds },
        tabulation: null,
      },
      orderBy: {
        datetime: "asc",
      },
    });
  }

  /**
   * Buscar conversas tabuladas de múltiplos operadores (modo linha compartilhada)
   */
  async findTabulatedConversationsByUserIds(userIds: number[]) {
    return this.prisma.conversation.findMany({
      where: {
        userId: { in: userIds },
        tabulation: { not: null },
      },
      orderBy: {
        datetime: "asc",
      },
    });
  }

  async findOne(id: number) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversa com ID ${id} não encontrada`);
    }

    return conversation;
  }

  async update(id: number, updateConversationDto: UpdateConversationDto) {
    await this.findOne(id);

    return this.prisma.conversation.update({
      where: { id },
      data: updateConversationDto,
    });
  }

  async tabulateConversation(contactPhone: string, tabulationId: number) {
    // Atualizar todas as mensagens daquele contactPhone que ainda não foram tabuladas
    return this.prisma.conversation.updateMany({
      where: {
        contactPhone,
        tabulation: null,
      },
      data: {
        tabulation: tabulationId,
      },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.conversation.delete({
      where: { id },
    });
  }

  async getConversationsBySegment(segment: number, tabulated: boolean = false) {
    return this.prisma.conversation.findMany({
      where: {
        segment,
        tabulation: tabulated ? { not: null } : null,
      },
      orderBy: {
        datetime: "desc",
      },
    });
  }

  /**
   * Rechamar contato após linha banida
   * Cria uma nova conversa ativa para o contato na nova linha do operador
   */
  async recallContact(
    contactPhone: string,
    userId: number,
    userLine: number | null,
  ) {
    if (!userLine) {
      throw new NotFoundException("Operador não possui linha atribuída");
    }

    // Buscar contato
    const contact = await this.prisma.contact.findFirst({
      where: { phone: contactPhone },
    });

    if (!contact) {
      throw new NotFoundException("Contato não encontrado");
    }

    // Buscar última conversa com este contato para pegar dados
    const lastConversation = await this.prisma.conversation.findFirst({
      where: { contactPhone },
      orderBy: { datetime: "desc" },
    });

    // Buscar dados do operador
    const operator = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!operator) {
      throw new NotFoundException("Operador não encontrado");
    }

    // Criar nova conversa ativa (não tabulada) na nova linha
    const newConversation = await this.prisma.conversation.create({
      data: {
        contactName: contact.name,
        contactPhone: contact.phone,
        segment:
          contact.segment || lastConversation?.segment || operator.segment,
        userName: operator.name,
        userLine: userLine,
        userId: userId,
        message: "Contato rechamado após linha banida",
        sender: "operator",
        messageType: "text",
        tabulation: null, // Conversa ativa
      },
    });

    return newConversation;
  }

  /**
   * Transferir conversa de um operador para outro
   * Atualiza userId e userName de todas as mensagens não tabuladas do contato
   */
  async transferConversation(
    contactPhone: string,
    targetUserId: number,
    currentUser: any,
  ) {
    // Buscar operador alvo
    const targetOperator = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetOperator) {
      throw new NotFoundException("Operador alvo não encontrado");
    }

    // Buscar conversa ativa para obter o segmento
    const activeConversation = await this.prisma.conversation.findFirst({
      where: {
        contactPhone,
        tabulation: null,
      },
      orderBy: { datetime: "desc" },
    });

    if (!activeConversation) {
      throw new NotFoundException(
        "Nenhuma conversa ativa encontrada para este contato",
      );
    }

    // Verificar que o operador alvo é do mesmo segmento da conversa
    if (
      activeConversation.segment &&
      targetOperator.segment !== activeConversation.segment
    ) {
      throw new NotFoundException(
        `Operador ${targetOperator.name} não pertence ao segmento da conversa`,
      );
    }

    // Buscar a linha do operador alvo
    const targetLineOp = await this.prisma.lineOperator.findFirst({
      where: { userId: targetUserId },
      include: { line: true },
    });

    // Atualizar todas as mensagens não tabuladas deste contato
    const updated = await this.prisma.conversation.updateMany({
      where: {
        contactPhone,
        tabulation: null,
      },
      data: {
        userId: targetUserId,
        userName: targetOperator.name,
        userLine: targetLineOp?.lineId || null,
      },
    });

    console.log(
      `🔄 [ConversationsService.transferConversation] Transferido ${updated.count} mensagens de ${contactPhone} para ${targetOperator.name} (userId: ${targetUserId})`,
    );

    return {
      transferred: updated.count,
      targetOperator: targetOperator.name,
      targetUserId: targetUserId,
    };
  }

  /** JID esperado pela Evolution API (texto / apagar para todos / editar). */
  private buildRemoteJidForEvolution(
    contactPhone: string,
    isGroup: boolean,
  ): string {
    if (isGroup || contactPhone.includes("@g.us")) {
      return contactPhone.includes("@g.us")
        ? contactPhone
        : `${contactPhone}@g.us`;
    }
    const digits = contactPhone.replace(/\D/g, "");
    if (!digits) return `${contactPhone}@s.whatsapp.net`;
    return `${digits}@s.whatsapp.net`;
  }

  /** Campo `number` do updateMessage (apenas dígitos). */
  private numberForUpdateMessage(contactPhone: string): string {
    return contactPhone.replace(/\D/g, "") || "0";
  }

  private assertUserCanTouchMessage(
    user: { id: number; role: Role },
    conv: { userId: number | null; sender: string },
  ) {
    if (user.role === Role.admin || user.role === Role.supervisor) return;
    if (user.role === Role.digital) {
      throw new ForbiddenException(
        "Perfil digital não pode editar ou apagar mensagens.",
      );
    }
    if (user.role === Role.operator) {
      if (conv.sender === "operator" && conv.userId === user.id) return;
      if (conv.sender === "contact") return;
      throw new ForbiddenException("Sem permissão para esta mensagem.");
    }
  }

  private withinWhatsAppEditWindow(convDatetime: Date): boolean {
    const limitMs = 15 * 60 * 1000;
    return Date.now() - new Date(convDatetime).getTime() <= limitMs;
  }

  /**
   * ID da mensagem no WhatsApp (Baileys `key.id`) — a Evolution exige string;
   * nunca usar o `id` interno numérico da tabela `Conversation`.
   */
  private requireWaMessageIdString(conversation: {
    waMessageId: string | null;
  }): string {
    const raw =
      conversation.waMessageId != null
        ? String(conversation.waMessageId).trim()
        : "";
    if (!raw) {
      throw new BadRequestException(
        "Esta mensagem não possui o ID original do WhatsApp e não pode ser alterada na API externa.",
      );
    }
    return raw;
  }

  /**
   * Soft delete local (`scope=me`) ou apagar para todos no WhatsApp + soft delete.
   */
  async operatorDeleteMessage(
    user: { id: number; role: Role },
    conversationId: number,
    scope: "me" | "everyone",
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: Number(conversationId) },
    });
    if (!conversation) {
      throw new NotFoundException(
        `Conversa com ID ${conversationId} não encontrada.`,
      );
    }

    this.assertUserCanTouchMessage(user, conversation);

    if (scope === "everyone") {
      if (conversation.sender !== "operator") {
        throw new BadRequestException(
          "Só é possível apagar para todos mensagens enviadas pelo atendimento.",
        );
      }
      this.requireWaMessageIdString(conversation);
      if (user.role === Role.operator && conversation.userId !== user.id) {
        throw new ForbiddenException(
          "Apenas o autor pode apagar para todos.",
        );
      }
    }

    let updated = conversation;

    if (scope === "everyone") {
      if (!conversation.userLine) {
        throw new BadRequestException("Mensagem sem linha associada.");
      }
      const line = await this.prisma.linesStock.findUnique({
        where: { id: conversation.userLine },
      });
      if (!line) {
        throw new NotFoundException("Linha não encontrada.");
      }
      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });
      if (!evolution) {
        throw new NotFoundException("Evolution não configurada.");
      }
      const instanceName = `line_${line.phone.replace(/\D/g, "")}`;
      const remoteJid = this.buildRemoteJidForEvolution(
        conversation.contactPhone,
        !!conversation.isGroup,
      );
      const waMessageId = this.requireWaMessageIdString(conversation);

      try {
        await axios.delete(
          `${evolution.evolutionUrl}/chat/deleteMessageForEveryone/${instanceName}`,
          {
            data: {
              id: waMessageId,
              remoteJid,
              fromMe: true,
              participant: "",
            },
            headers: { apikey: evolution.evolutionKey },
            timeout: 30000,
          },
        );
      } catch (e: any) {
        const msg =
          e?.response?.data?.message || e?.message || "Evolution API error";
        throw new BadRequestException(
          `Falha ao apagar no WhatsApp: ${msg}`,
        );
      }
      updated = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { isDeleted: true },
      });
    } else {
      updated = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { isDeleted: true },
      });
    }

    await this.websocketGateway.emitMessageUpdated(updated);
    return updated;
  }

  /**
   * Encaminha uma mensagem existente para outro contato/grupo (WhatsApp Forward).
   */
  async forwardMessage(
    user: { id: number; role: Role; name: string; segment?: number | null; line?: number | null },
    originalMessageId: number,
    destinationPhone: string,
  ) {
    const destPhone = destinationPhone?.trim();
    if (!destPhone) {
      throw new BadRequestException('Destino inválido para encaminhamento.');
    }

    const original = await this.prisma.conversation.findUnique({
      where: { id: Number(originalMessageId) },
    });
    if (!original) {
      throw new NotFoundException(
        `Mensagem com ID ${originalMessageId} não encontrada.`,
      );
    }

    if (original.isDeleted) {
      throw new BadRequestException('Não é possível encaminhar mensagem apagada.');
    }

    if (original.messageType === 'reaction') {
      throw new BadRequestException('Não é possível encaminhar reações.');
    }

    this.assertUserCanTouchMessage(user, original);

    let lineId = user.line ?? null;
    if (!lineId) {
      const lineOperator = await this.prisma.lineOperator.findFirst({
        where: { userId: user.id },
        select: { lineId: true },
      });
      lineId = lineOperator?.lineId ?? null;
    }

    if (!lineId) {
      throw new BadRequestException(
        'Operador sem linha WhatsApp vinculada para encaminhar.',
      );
    }

    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
    });
    if (!line || line.lineStatus !== 'active') {
      throw new BadRequestException('Linha WhatsApp não disponível.');
    }

    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: line.evolutionName },
    });
    if (!evolution) {
      throw new NotFoundException('Evolution não configurada.');
    }

    const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
    const sourceRemoteJid = this.buildRemoteJidForEvolution(
      original.contactPhone,
      !!original.isGroup,
    );
    const destIsGroup = destPhone.includes('@g.us');

    let apiResponse: any = null;
    let usedNativeForward = false;

    const waMessageId = original.waMessageId?.trim();

    if (waMessageId) {
      try {
        apiResponse = await this.evolutionService.forwardMessage(
          evolution.evolutionUrl,
          evolution.evolutionKey,
          instanceName,
          {
            destinationPhone: destPhone,
            sourceRemoteJid,
            messageId: waMessageId,
            fromMe: original.sender === 'operator',
          },
        );
        usedNativeForward = true;
      } catch (err: any) {
        console.warn(
          `[Conversations] Encaminhamento nativo falhou (msg#${original.id}), usando fallback de reenvio: ${err?.message}`,
        );
      }
    }

    if (!apiResponse) {
      apiResponse = await this.evolutionService.resendMessageContent(
        evolution.evolutionUrl,
        evolution.evolutionKey,
        instanceName,
        destPhone,
        {
          message: original.message,
          messageType: original.messageType,
          mediaUrl: original.mediaUrl,
        },
      );
    }

    const destinationContact = await this.prisma.contact.findFirst({
      where: { phone: destPhone },
    });

    const destinationName =
      destinationContact?.customTitle?.trim() ||
      destinationContact?.name?.trim() ||
      destPhone;

    const outboundText =
      original.message?.trim() ||
      (original.messageType === 'image'
        ? 'Imagem enviada'
        : original.messageType === 'video'
          ? 'Vídeo enviado'
          : original.messageType === 'audio'
            ? 'Áudio enviado'
            : original.messageType === 'document'
              ? 'Documento enviado'
              : 'Mensagem encaminhada');

    let conversation = await this.create({
      contactName: destinationName,
      contactPhone: destPhone,
      segment: user.segment ?? undefined,
      userName: user.name,
      userLine: lineId,
      userId: user.id,
      message: usedNativeForward
        ? outboundText
        : `↪ ${outboundText}`.replace(/^↪ ↪ /, '↪ '),
      sender: 'operator',
      messageType: original.messageType,
      mediaUrl: original.mediaUrl ?? undefined,
      isGroup: destIsGroup,
      groupId: destIsGroup ? destPhone : undefined,
      groupName: destIsGroup ? destinationName : undefined,
    });

    const waFromEvolution =
      extractWaMessageIdFromEvolutionSendResponse(apiResponse?.data);
    if (waFromEvolution) {
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { waMessageId: waFromEvolution },
      });
    }

    if (!destIsGroup) {
      await this.websocketGateway.createOrUpdateConversationBinding(
        destPhone,
        lineId,
        user.id,
      );
    }

    await this.websocketGateway.emitNewMessage(conversation);

    return conversation;
  }

  async operatorEditMessage(
    user: { id: number; role: Role },
    conversationId: number,
    newText: string,
  ) {
    const text = newText?.trim();
    if (!text) {
      throw new BadRequestException("Texto inválido.");
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: Number(conversationId) },
    });
    if (!conversation) {
      throw new NotFoundException(
        `Conversa com ID ${conversationId} não encontrada.`,
      );
    }

    this.assertUserCanTouchMessage(user, conversation);

    if (conversation.sender !== "operator") {
      throw new BadRequestException(
        "Só mensagens do atendimento podem ser editadas.",
      );
    }
    if (user.role === Role.operator && conversation.userId !== user.id) {
      throw new ForbiddenException("Apenas o autor pode editar.");
    }

    const waMessageId = this.requireWaMessageIdString(conversation);

    if (!this.withinWhatsAppEditWindow(conversation.datetime)) {
      throw new BadRequestException(
        "Prazo de edição expirado (15 minutos no WhatsApp).",
      );
    }
    if (conversation.messageType !== "text") {
      throw new BadRequestException(
        "Por enquanto só mensagens de texto podem ser editadas pelo painel.",
      );
    }
    if (!conversation.userLine) {
      throw new BadRequestException("Mensagem sem linha associada.");
    }

    const line = await this.prisma.linesStock.findUnique({
      where: { id: conversation.userLine },
    });
    if (!line) throw new NotFoundException("Linha não encontrada.");
    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: line.evolutionName },
    });
    if (!evolution) throw new NotFoundException("Evolution não configurada.");

    const instanceName = `line_${line.phone.replace(/\D/g, "")}`;
    const remoteJid = this.buildRemoteJidForEvolution(
      conversation.contactPhone,
      !!conversation.isGroup,
    );
    /** Evolution costuma esperar `number` como string (apenas dígitos). */
    const numberStr = this.numberForUpdateMessage(conversation.contactPhone);

    try {
      await axios.post(
        `${evolution.evolutionUrl}/chat/updateMessage/${instanceName}`,
        {
          number: numberStr || "0",
          text,
          key: {
            remoteJid,
            fromMe: true,
            id: waMessageId,
          },
        },
        {
          headers: { apikey: evolution.evolutionKey },
          timeout: 30000,
        },
      );
    } catch (e: any) {
      const msg =
        e?.response?.data?.message || e?.message || "Evolution API error";
      throw new BadRequestException(`Falha ao editar no WhatsApp: ${msg}`);
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { message: text, isEdited: true },
    });

    await this.websocketGateway.emitMessageUpdated(updated);
    return updated;
  }
}
