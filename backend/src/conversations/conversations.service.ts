import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { CreateConversationDto } from "./dto/create-conversation.dto";
import { UpdateConversationDto } from "./dto/update-conversation.dto";

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

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
      },
    });

    const contactsByPhone = new Map(contacts.map((c) => [c.phone, c]));

    return conversations.map((conv) => {
      const contact = contactsByPhone.get(conv.contactPhone);

      const contactCustomTitle = contact?.customTitle?.trim() || null;
      const contactOriginalName = contact?.name?.trim() || null;
      const snapshotName = conv.contactName?.trim() || null;

      const displayTitle =
        contactCustomTitle ||
        contactOriginalName ||
        snapshotName ||
        "Desconhecido";

      // Sobrescreve contactName com o título resolvido e expõe customTitle
      // na raiz. Nenhum objeto relacional é vazado no payload REST.
      return {
        ...conv,
        contactName: displayTitle,
        customTitle: contactCustomTitle,
      };
    });
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

    return conversations;
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

    return conversations;
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
}
