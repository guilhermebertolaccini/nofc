import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ReportFilterDto } from "./dto/report-filter.dto";

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) { }

  // Timezone padrão para formatação de datas (São Paulo, Brasil)
  private readonly TIMEZONE = "America/Sao_Paulo";

  /** Contas internas (seed) — excluídas de agregados nos relatórios */
  private readonly internalEmailMarker = "@tatica.internal";

  /**
   * Helper: Formatar data como YYYY-MM-DD (formato ISO) no timezone de São Paulo
   */
  private formatDate(date: Date): string {
    const d = new Date(date);
    const options: Intl.DateTimeFormatOptions = {
      timeZone: this.TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(d);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return `${year}-${month}-${day}`;
  }

  /**
   * Helper: Formatar data como DD/MM/YYYY (formato brasileiro) no timezone de São Paulo
   */
  private formatDateBrazilian(date: Date): string {
    const d = new Date(date);
    return d.toLocaleDateString("pt-BR", {
      timeZone: this.TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  /**
   * Helper: Formatar data e hora como DD/MM/YYYY HH:MM:SS no timezone de São Paulo
   */
  private formatDateTime(date: Date): string {
    const d = new Date(date);
    return d
      .toLocaleString("pt-BR", {
        timeZone: this.TIMEZONE,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
      .replace(",", "");
  }

  /**
   * Helper: Formatar hora como HH:MM:SS no timezone de São Paulo
   */
  private formatTime(date: Date): string {
    const d = new Date(date);
    return d.toLocaleTimeString("pt-BR", {
      timeZone: this.TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  /**
   * IDs de usuários com email interno (ex.: contas de demonstração do seed).
   */
  private async getExcludedInternalUserIds(): Promise<number[]> {
    const internalUsers = await this.prisma.user.findMany({
      where: {
        email: {
          contains: this.internalEmailMarker,
        },
      },
      select: { id: true },
    });
    return internalUsers.map((u) => u.id);
  }

  /**
   * Helper: Aplicar filtro de identificador
   * Cliente só vê seus dados, proprietário vê tudo
   * SEMPRE filtra isAdminTest = false (ações de teste administrador não aparecem nos relatórios)
   * SEMPRE exclui usuários com email interno (exceto para relatórios de linhas)
   */
  private async applyIdentifierFilter(
    whereClause: any,
    userIdentifier: "cliente" | "proprietario" | undefined,
    filterType: "conversation" | "campaign" | "user" | "segment" | "line",
    excludeInternalUsers: boolean = true,
  ): Promise<any> {
    // SEMPRE filtrar ações de teste administrador (não aparecem nos relatórios)
    if (filterType === "conversation" || filterType === "campaign") {
      whereClause.isAdminTest = false;
    }

    // Excluir usuários internos (exceto para linhas)
    if (excludeInternalUsers && filterType !== "line") {
      const internalUserIds = await this.getExcludedInternalUserIds();
      if (internalUserIds.length > 0) {
        if (filterType === "conversation") {
          // Para conversas, excluir se userId está na lista interna
          // IMPORTANTE: Se já existe filtro OR, precisamos adicionar o filtro em cada condição OR
          if (whereClause.OR && Array.isArray(whereClause.OR)) {
            // Se tem OR, adicionar filtro em cada condição OR que tenha userId
            whereClause.OR = whereClause.OR.map((orCondition: any) => {
              if (orCondition.userId) {
                if (
                  typeof orCondition.userId === "object" &&
                  orCondition.userId.in
                ) {
                  orCondition.userId.in = orCondition.userId.in.filter(
                    (id: number) => !internalUserIds.includes(id),
                  );
                  if (orCondition.userId.in.length === 0) {
                    return { id: -1 }; // Filtro impossível para esta condição
                  }
                } else if (typeof orCondition.userId === "number") {
                  if (internalUserIds.includes(orCondition.userId)) {
                    return { id: -1 }; // Filtro impossível para esta condição
                  }
                } else {
                  orCondition.userId = {
                    ...orCondition.userId,
                    notIn: internalUserIds,
                  };
                }
              } else {
                orCondition.userId = {
                  notIn: internalUserIds,
                };
              }
              return orCondition;
            });
            // Remover condições impossíveis
            whereClause.OR = whereClause.OR.filter(
              (orCondition: any) => !(orCondition.id === -1),
            );
            // Se todas as condições OR foram removidas, retornar filtro impossível
            if (whereClause.OR.length === 0) {
              return { id: -1 };
            }
          } else if (whereClause.userId) {
            // Se já tem filtro de userId, adicionar NOT IN
            if (
              typeof whereClause.userId === "object" &&
              whereClause.userId.in
            ) {
              // Se já é um array, filtrar removendo usuários internos
              whereClause.userId.in = whereClause.userId.in.filter(
                (id: number) => !internalUserIds.includes(id),
              );
              // Se após filtrar não sobrou nenhum, retornar filtro impossível
              if (whereClause.userId.in.length === 0) {
                return { id: -1 };
              }
            } else if (typeof whereClause.userId === "number") {
              if (internalUserIds.includes(whereClause.userId)) {
                return { id: -1 }; // Filtro impossível
              }
            } else if (whereClause.userId.notIn) {
              const combinedNotIn = [
                ...new Set([...whereClause.userId.notIn, ...internalUserIds]),
              ];
              whereClause.userId.notIn = combinedNotIn;
            } else {
              whereClause.userId = {
                ...whereClause.userId,
                notIn: internalUserIds,
              };
            }
          } else {
            whereClause.userId = {
              notIn: internalUserIds,
            };
          }
        } else if (filterType === "user") {
          // Para usuários, excluir diretamente por email
          if (!whereClause.email) {
            whereClause.email = {};
          }
          const existingEmailFilters: any = {};
          if (whereClause.email.endsWith)
            existingEmailFilters.endsWith = whereClause.email.endsWith;
          if (whereClause.email.startsWith)
            existingEmailFilters.startsWith = whereClause.email.startsWith;

          whereClause.email = {
            ...existingEmailFilters,
            not: {
              contains: this.internalEmailMarker,
            },
          };
        }
        // Para campanhas, não há userId direto, mas podemos filtrar por linha se necessário
        // (campanhas não têm userId, então não precisa filtrar aqui)
      }
    }

    // Se não tem identificador ou é proprietário, não aplicar filtro adicional
    if (!userIdentifier || userIdentifier === "proprietario") {
      return whereClause;
    }

    // Se é cliente, aplicar filtro
    if (userIdentifier === "cliente") {
      if (filterType === "conversation") {
        // Para conversas: filtrar por segmento OU usuário com identifier = 'cliente'
        const clienteSegments = await this.prisma.segment.findMany({
          where: { identifier: "cliente" },
          select: { id: true },
        });
        const clienteSegmentIds = clienteSegments.map((s) => s.id);

        const clienteUsers = await this.prisma.user.findMany({
          where: { identifier: "cliente" },
          select: { id: true },
        });
        const clienteUserIds = clienteUsers.map((u) => u.id);

        // Se já existe filtro de segment, verificar se é cliente
        if (whereClause.segment) {
          if (!clienteSegmentIds.includes(whereClause.segment)) {
            // Segmento filtrado não é cliente, retornar where impossível
            return { id: -1 }; // Filtro impossível
          }
          // Segmento é cliente, manter filtro existente mas também adicionar filtro por userId
          if (clienteUserIds.length > 0) {
            // Adicionar filtro OR para incluir conversas de usuários clientes também
            const existingSegment = whereClause.segment;
            whereClause.OR = [
              { segment: existingSegment },
              { userId: { in: clienteUserIds } },
            ];
            delete whereClause.segment; // Remover filtro direto, usar OR
          }
        } else {
          // Não tem filtro de segment, aplicar filtro de cliente
          const orConditions = [];
          if (clienteSegmentIds.length > 0) {
            orConditions.push({ segment: { in: clienteSegmentIds } });
          }
          if (clienteUserIds.length > 0) {
            orConditions.push({ userId: { in: clienteUserIds } });
          }

          if (orConditions.length === 0) {
            return { id: -1 }; // Nenhum dado cliente encontrado
          }

          whereClause.OR = orConditions;
        }
      } else if (filterType === "campaign") {
        // Para campanhas: filtrar por segmento com identifier = 'cliente'
        const clienteSegments = await this.prisma.segment.findMany({
          where: { identifier: "cliente" },
          select: { id: true },
        });
        const clienteSegmentIds = clienteSegments.map((s) => s.id);

        if (whereClause.contactSegment) {
          if (!clienteSegmentIds.includes(whereClause.contactSegment)) {
            return { id: -1 }; // Filtro impossível
          }
        } else {
          whereClause.contactSegment =
            clienteSegmentIds.length > 0 ? { in: clienteSegmentIds } : null;
          if (whereClause.contactSegment === null) {
            return { id: -1 }; // Nenhum segmento cliente encontrado
          }
        }
      } else if (filterType === "user") {
        // Para usuários: filtrar por identifier = 'cliente'
        whereClause.identifier = "cliente";
      } else if (filterType === "segment") {
        // Para segmentos: filtrar por identifier = 'cliente'
        whereClause.identifier = "cliente";
      } else if (filterType === "line") {
        // Para linhas: filtrar por segmento com identifier = 'cliente'
        const clienteSegments = await this.prisma.segment.findMany({
          where: { identifier: "cliente" },
          select: { id: true },
        });
        const clienteSegmentIds = clienteSegments.map((s) => s.id);

        if (whereClause.segment) {
          if (!clienteSegmentIds.includes(whereClause.segment)) {
            return { id: -1 }; // Filtro impossível
          }
        } else {
          whereClause.segment =
            clienteSegmentIds.length > 0 ? { in: clienteSegmentIds } : null;
          if (whereClause.segment === null) {
            return { id: -1 }; // Nenhum segmento cliente encontrado
          }
        }
      }
    }

    return whereClause;
  }

  /**
   * Helper: Normalizar texto para garantir encoding UTF-8 correto
   * Remove problemas de encoding e garante que caracteres especiais sejam exibidos corretamente
   */
  private normalizeText(text: string | null | undefined): string | null {
    if (!text) return null;

    try {
      // Garantir que o texto está em UTF-8
      if (typeof text !== "string") {
        text = String(text);
      }

      // Normalizar Unicode (NFD -> NFC) para garantir caracteres compostos corretos
      // Isso resolve problemas com acentos e caracteres especiais
      let normalized = text.normalize("NFC");

      // Garantir que está em UTF-8 válido
      // Se houver caracteres inválidos, tentar reparar
      try {
        // Forçar encoding UTF-8
        const buffer = Buffer.from(normalized, "utf8");
        normalized = buffer.toString("utf8");
      } catch (e) {
        // Se falhar, tentar latin1 -> utf8 (para reparar caracteres corrompidos)
        try {
          const buffer = Buffer.from(text, "latin1");
          normalized = buffer.toString("utf8");
          // Normalizar novamente após reparo
          normalized = normalized.normalize("NFC");
        } catch (e2) {
          // Se ainda falhar, retornar original
          console.warn("Erro ao normalizar texto:", e2);
        }
      }

      return normalized;
    } catch (error) {
      // Se houver erro, retornar texto original
      console.warn("Erro ao normalizar texto:", error);
      return text;
    }
  }

  /**
   * Helper: Normalizar objeto recursivamente, aplicando normalização em todos os valores string
   */
  private normalizeObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.normalizeObject(item));
    }

    if (typeof obj === "object") {
      const normalized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string") {
          normalized[key] = this.normalizeText(value);
        } else {
          normalized[key] = this.normalizeObject(value);
        }
      }
      return normalized;
    }

    if (typeof obj === "string") {
      return this.normalizeText(obj);
    }

    return obj;
  }

  /**
   * OP SINTÉTICO
   * Estrutura: Segmento, Data, Hora, Qtd. Total Mensagens, Qtd. Total Entrantes,
   * Qtd. Promessas, Conversão, Tempo Médio Transbordo, Tempo Médio Espera Total,
   * Tempo Médio Atendimento, Tempo Médio Resposta
   */
  async getOpSinteticoReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    console.log(
      "📊 [Reports] OP Sintético - Filtros:",
      JSON.stringify(filters),
    );

    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    console.log(
      "📊 [Reports] OP Sintético - Where:",
      JSON.stringify(finalWhereClause),
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "asc" },
    });

    console.log(
      `📊 [Reports] OP Sintético - ${conversations.length} conversas encontradas`,
    );

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    // Agrupar por segmento e data
    const grouped: Record<string, Record<string, any>> = {};

    conversations.forEach((conv) => {
      const segmentName = conv.segment
        ? segmentMap.get(conv.segment)?.name || "Sem Segmento"
        : "Sem Segmento";
      const date = this.formatDate(conv.datetime);

      const key = `${segmentName}|${date}`;
      if (!grouped[key]) {
        grouped[key] = {
          segment: segmentName,
          date,
          totalMensagens: 0,
          entrantes: 0,
          promessas: 0,
          tempos: [],
        };
      }

      grouped[key].totalMensagens++;

      if (conv.sender === "contact") {
        grouped[key].entrantes++;
      }

      // Verificar se é promessa (tabulação CPC)
      if (conv.tabulation) {
        const tabulation = tabulationMap.get(conv.tabulation);
        if (tabulation?.isCPC) {
          grouped[key].promessas++;
        }
      }
    });

    const result = Object.values(grouped).map((item: any) => ({
      Segmento: item.segment,
      Data: item.date,
      Hora: null, // Agregado por dia, não por hora específica
      "Qtd. Total Mensagens": item.totalMensagens,
      "Qtd. Total Entrantes": item.entrantes,
      "Qtd. Promessas": item.promessas,
      Conversão:
        item.totalMensagens > 0
          ? `${((item.promessas / item.totalMensagens) * 100).toFixed(2)}%`
          : "0%",
      "Tempo Médio Transbordo": null,
      "Tempo Médio Espera Total": null,
      "Tempo Médio Atendimento": null,
      "Tempo Médio Resposta": null,
    }));

    // Se não houver dados, retornar registro vazio com cabeçalhos
    if (result.length === 0) {
      return this.normalizeObject([
        {
          Segmento: "",
          Data: "",
          Hora: "",
          "Qtd. Total Mensagens": 0,
          "Qtd. Total Entrantes": 0,
          "Qtd. Promessas": 0,
          Conversão: "0%",
          "Tempo Médio Transbordo": "",
          "Tempo Médio Espera Total": "",
          "Tempo Médio Atendimento": "",
          "Tempo Médio Resposta": "",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO KPI
   * Estrutura: Data Evento, Descrição Evento, Tipo de Evento, Evento Finalizador,
   * Contato, Identificação, Código Contato, Hashtag, Usuário, Número Protocolo,
   * Data Hora Geração Protocolo, Observação, SMS Principal, Whatsapp Principal,
   * Email Principal, Canal, Carteiras, Carteira do Evento, Valor da oportunidade,
   * Identificador da chamada de Voz
   */
  async getKpiReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    console.log("📊 [Reports] KPI - Filtros:", JSON.stringify(filters));

    const whereClause: any = {
      tabulation: { not: null },
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    console.log("📊 [Reports] KPI - Where:", JSON.stringify(finalWhereClause));

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "desc" },
    });

    console.log(
      `📊 [Reports] KPI - ${conversations.length} conversas encontradas`,
    );

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const result = conversations.map((conv) => {
      const tabulation = conv.tabulation
        ? tabulationMap.get(conv.tabulation)
        : null;
      const segment = conv.segment ? segmentMap.get(conv.segment) : null;
      const contact = contactMap.get(conv.contactPhone);

      return {
        "Data Evento": this.formatDate(conv.datetime),
        "Descrição Evento": tabulation?.name || "Sem Tabulação",
        "Tipo de Evento": tabulation?.isCPC ? "CPC" : "Atendimento",
        "Evento Finalizador": tabulation ? "Sim" : "Não",
        Contato: conv.contactName,
        Identificação: contact?.cpf || null,
        "Código Contato": contact?.id || null,
        Hashtag: null,
        Usuário: conv.userName || null,
        "Número Protocolo": null,
        "Data Hora Geração Protocolo": null,
        Observação: conv.message,
        "SMS Principal": null,
        "Whatsapp Principal": conv.contactPhone,
        "Email Principal": null,
        Canal: "WhatsApp",
        Carteiras: segment?.name || null,
        "Carteira do Evento": segment?.name || null,
        "Valor da oportunidade": null,
        "Identificador da chamada de Voz": null,
      };
    });

    // Se não houver dados, retornar registro vazio com cabeçalhos
    if (result.length === 0) {
      return this.normalizeObject([
        {
          "Data Evento": "",
          "Descrição Evento": "",
          "Tipo de Evento": "",
          "Evento Finalizador": "",
          Contato: "",
          Identificação: "",
          "Código Contato": "",
          Hashtag: "",
          Usuário: "",
          "Número Protocolo": "",
          "Data Hora Geração Protocolo": "",
          Observação: "Nenhum registro encontrado no período selecionado",
          "SMS Principal": "",
          "Whatsapp Principal": "",
          "Email Principal": "",
          Canal: "",
          Carteiras: "",
          "Carteira do Evento": "",
          "Valor da oportunidade": "",
          "Identificador da chamada de Voz": "",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO HSM
   * Estrutura: Contato, Identificador, Código, Hashtag, Template, WhatsApp do contato,
   * Solicitação envio, Envio, Confirmação, Leitura (se habilitado), Falha entrega,
   * Motivo falha, WhatsApp de saida, Usuário Solicitante, Carteira, Teve retorno
   */
  async getHsmReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "campaign",
    );

    console.log("📊 [Reports] HSM - Where:", JSON.stringify(finalWhereClause));

    const campaigns = await this.prisma.campaign.findMany({
      where: finalWhereClause,
      orderBy: { dateTime: "desc" },
    });

    console.log(`📊 [Reports] HSM - ${campaigns.length} campanhas encontradas`);

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    const result = campaigns.map((campaign) => {
      const contact = contactMap.get(campaign.contactPhone);
      const segment = campaign.contactSegment
        ? segmentMap.get(campaign.contactSegment)
        : null;
      const line = campaign.lineReceptor
        ? lineMap.get(campaign.lineReceptor)
        : null;

      return {
        Contato: campaign.contactName,
        Identificador: contact?.cpf || null,
        Código: contact?.id || null,
        Hashtag: null,
        Template: campaign.name,
        "WhatsApp do contato": campaign.contactPhone,
        "Solicitação envio": this.formatDate(campaign.createdAt),
        Envio: this.formatDate(campaign.dateTime),
        Confirmação: campaign.response ? "Sim" : "Não",
        "Leitura (se habilitado)": null,
        "Falha entrega": campaign.retryCount > 0 ? "Sim" : "Não",
        "Motivo falha": null,
        "WhatsApp de saida": line?.phone || null,
        "Usuário Solicitante": null,
        Carteira: segment?.name || null,
        "Teve retorno": campaign.response ? "Sim" : "Não",
      };
    });

    // Se não houver dados, retornar registro vazio com cabeçalhos
    if (result.length === 0) {
      return this.normalizeObject([
        {
          Contato: "",
          Identificador: "",
          Código: "",
          Hashtag: "",
          Template: "",
          "WhatsApp do contato": "",
          "Solicitação envio": "",
          Envio: "Nenhum registro encontrado no período selecionado",
          Confirmação: "",
          "Leitura (se habilitado)": "",
          "Falha entrega": "",
          "Motivo falha": "",
          "WhatsApp de saida": "",
          "Usuário Solicitante": "",
          Carteira: "",
          "Teve retorno": "",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO STATUS DE LINHA
   * Estrutura: Data, Numero, Business, QualityScore (Ativo/Banido), Tier, Segmento
   */
  async getLineStatusReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    // Aplicar filtro de data baseado em updatedAt
    if (filters.startDate || filters.endDate) {
      whereClause.updatedAt = {};
      if (filters.startDate) {
        whereClause.updatedAt.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        whereClause.updatedAt.lte = new Date(
          `${filters.endDate}T23:59:59.999Z`,
        );
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "line",
    );

    console.log(
      "📊 [Reports] Status de Linha - Where:",
      JSON.stringify(finalWhereClause),
    );

    const lines = await this.prisma.linesStock.findMany({
      where: finalWhereClause,
      orderBy: { updatedAt: "desc" },
    });

    console.log(
      `📊 [Reports] Status de Linha - ${lines.length} linhas encontradas`,
    );

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const result = lines.map((line) => {
      const segment = line.segment ? segmentMap.get(line.segment) : null;

      return {
        Data: this.formatDate(line.updatedAt),
        Número: line.phone,
        "ID Negócio": line.businessID || "N/A",
        "Pontuação de Qualidade":
          line.lineStatus === "active" ? "Ativo" : "Banido",
        Nível: "Não oficial",
        Segmento: segment?.name || "Sem segmento",
      };
    });

    // Se não houver dados, retornar registro vazio com cabeçalhos
    if (result.length === 0) {
      return this.normalizeObject([
        {
          Data: "",
          Número: "",
          "ID Negócio": "",
          "Pontuação de Qualidade": "",
          Nível: "",
          Segmento: "Nenhuma linha encontrada no período selecionado",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO ADM LINHAS (APENAS ADMIN)
   * Estrutura: Nome da Linha, Data Criação, Status, Segmento, Data Update
   * Filtro de data baseado em createdAt (data de criação da linha)
   */
  async getAdmLinhasReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    // Aplicar filtro de data baseado em createdAt (data de criação)
    if (filters.startDate || filters.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = new Date(
          `${filters.endDate}T23:59:59.999Z`,
        );
      }
    }

    console.log(
      "📊 [Reports] Adm Linhas - Where:",
      JSON.stringify(whereClause),
    );

    const lines = await this.prisma.linesStock.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
    });

    console.log(`📊 [Reports] Adm Linhas - ${lines.length} linhas encontradas`);

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const result = lines.map((line) => {
      const segment = line.segment ? segmentMap.get(line.segment) : null;
      const firstSegment = line.firstSegmentId
        ? segmentMap.get(line.firstSegmentId)
        : null;

      const transferDate = line.firstTransferAt || line.updatedAt;

      return {
        "Nome da Linha": line.realNumber || line.phone,
        "Data Criação": this.formatDateTime(line.createdAt),
        Status: line.lineStatus === "active" ? "Ativo" : "Banido",
        Segmento: firstSegment?.name || segment?.name || "Sem segmento",
        "Data de Transferência": this.formatDateTime(transferDate),
        "Data Update": this.formatDateTime(line.updatedAt),
      };
    });

    // Se não houver dados, retornar registro vazio com cabeçalhos
    if (result.length === 0) {
      return this.normalizeObject([
        {
          "Nome da Linha": "",
          "Data Criação": "",
          Status: "",
          Segmento: "Nenhuma linha encontrada no período selecionado",
          "Data Update": "",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE ENVIOS
   * Estrutura: data_envio, hora_envio, fornecedor_envio, codigo_carteira, nome_carteira,
   * segmento_carteira, numero_contrato, cpf_cliente, telefone_cliente, status_envio,
   * numero_saida, login_usuario, template_envio, tipo_envio, cliente_respondeu,
   * qtd_mensagens_cliente, qtd_mensagens_operador
   */
  async getEnviosReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador para campanhas
    const finalCampaignWhere = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "campaign",
    );

    // Buscar campanhas (envios massivos)
    const campaigns = await this.prisma.campaign.findMany({
      where: finalCampaignWhere,
      orderBy: { dateTime: "desc" },
    });

    // Buscar conversas de operadores (envios 1:1)
    const conversationWhere: any = {
      sender: "operator",
    };
    if (filters.segment) {
      conversationWhere.segment = filters.segment;
    }
    if (filters.startDate || filters.endDate) {
      conversationWhere.datetime = {};
      if (filters.startDate) {
        conversationWhere.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        conversationWhere.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador para conversas
    const finalConversationWhere = await this.applyIdentifierFilter(
      conversationWhere,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalConversationWhere,
      orderBy: { datetime: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    // Buscar TODAS as conversas relacionadas (incluindo respostas do cliente) para calcular métricas
    const allConversationsWhere: any = {};
    if (filters.startDate || filters.endDate) {
      allConversationsWhere.datetime = {};
      if (filters.startDate) {
        allConversationsWhere.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        allConversationsWhere.datetime.lte = new Date(filters.endDate);
      }
    }
    const finalAllConversationsWhere = await this.applyIdentifierFilter(
      allConversationsWhere,
      userIdentifier,
      "conversation",
    );

    const allConversations = await this.prisma.conversation.findMany({
      where: finalAllConversationsWhere,
      orderBy: { datetime: "asc" },
    });

    // Agrupar conversas por telefone e linha para analisar respostas
    // Chave: `${contactPhone}|${userLine}` para identificar uma "conversa"
    const conversationsByPhoneLine = new Map<string, any[]>();
    allConversations.forEach((conv) => {
      const key = `${conv.contactPhone}|${conv.userLine || "null"}`;
      if (!conversationsByPhoneLine.has(key)) {
        conversationsByPhoneLine.set(key, []);
      }
      conversationsByPhoneLine.get(key)!.push(conv);
    });

    // Função auxiliar para calcular métricas de uma conversa
    const calculateConversationMetrics = (
      phone: string,
      lineId: number | null,
      afterDate?: Date,
    ) => {
      const key = `${phone}|${lineId || "null"}`;
      const convs = conversationsByPhoneLine.get(key) || [];

      // Se afterDate foi fornecido, filtrar apenas conversas após essa data
      const relevantConvs = afterDate
        ? convs.filter((c) => c.datetime > afterDate)
        : convs;

      const clientMessages = relevantConvs.filter(
        (c) => c.sender === "contact",
      ).length;
      const operatorMessages = relevantConvs.filter(
        (c) => c.sender === "operator",
      ).length;
      const clientResponded = clientMessages > 0;

      return {
        clientResponded,
        clientMessagesCount: clientMessages,
        operatorMessagesCount: operatorMessages,
      };
    };

    const result: any[] = [];

    // Processar campanhas (massivos)
    campaigns.forEach((campaign) => {
      const contact = contactMap.get(campaign.contactPhone);
      const segment = campaign.contactSegment
        ? segmentMap.get(campaign.contactSegment)
        : null;
      const line = campaign.lineReceptor
        ? lineMap.get(campaign.lineReceptor)
        : null;

      // Calcular métricas: verificar se houve conversas após o envio da campanha
      const metrics = calculateConversationMetrics(
        campaign.contactPhone,
        campaign.lineReceptor || null,
        campaign.dateTime, // Apenas conversas após o envio da campanha
      );

      result.push({
        data_envio: this.formatDate(campaign.dateTime),
        hora_envio: this.formatTime(campaign.dateTime),
        fornecedor_envio: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        nome_carteira: segment?.name || null,
        segmento_carteira: segment?.name || null,
        numero_contrato: contact?.contract || null,
        cpf_cliente: contact?.cpf || null,
        telefone_cliente: campaign.contactPhone,
        status_envio: campaign.response ? "Entregue" : "Pendente",
        numero_saida: line?.phone || null,
        login_usuario: null,
        template_envio: campaign.name,
        tipo_envio: "Massivo",
        cliente_respondeu: metrics.clientResponded ? "Verdadeiro" : "Falso",
        qtd_mensagens_cliente: metrics.clientMessagesCount,
        qtd_mensagens_operador: metrics.operatorMessagesCount,
      });
    });

    // Processar conversas 1:1
    // Agrupar conversas por telefone+linha para processar cada "conversa" apenas uma vez
    const conversationGroups = new Map<string, any[]>();
    conversations.forEach((conv) => {
      const key = `${conv.contactPhone}|${conv.userLine || "null"}`;
      if (!conversationGroups.has(key)) {
        conversationGroups.set(key, []);
      }
      conversationGroups.get(key)!.push(conv);
    });

    // Processar cada grupo de conversa (uma linha por "conversa")
    conversationGroups.forEach((convs, key) => {
      // Pegar a primeira mensagem do operador dessa conversa (primeiro envio 1:1)
      const firstOperatorMessage = convs.sort(
        (a, b) => a.datetime.getTime() - b.datetime.getTime(),
      )[0];

      // Calcular métricas de toda a conversa (todas as mensagens relacionadas)
      const metrics = calculateConversationMetrics(
        firstOperatorMessage.contactPhone,
        firstOperatorMessage.userLine || null,
        // Não passar afterDate para incluir toda a conversa relacionada
      );

      const contact = contactMap.get(firstOperatorMessage.contactPhone);
      const segment = firstOperatorMessage.segment
        ? segmentMap.get(firstOperatorMessage.segment)
        : null;
      const line = firstOperatorMessage.userLine
        ? lineMap.get(firstOperatorMessage.userLine)
        : null;

      result.push({
        data_envio: this.formatDate(firstOperatorMessage.datetime),
        hora_envio: this.formatTime(firstOperatorMessage.datetime),
        fornecedor_envio: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        nome_carteira: segment?.name || null,
        segmento_carteira: segment?.name || null,
        numero_contrato: contact?.contract || null,
        cpf_cliente: contact?.cpf || null,
        telefone_cliente: firstOperatorMessage.contactPhone,
        status_envio: "Enviado",
        numero_saida: line?.phone || null,
        login_usuario: firstOperatorMessage.userName || null,
        template_envio: null,
        tipo_envio: "1:1",
        cliente_respondeu: metrics.clientResponded ? "Verdadeiro" : "Falso",
        qtd_mensagens_cliente: metrics.clientMessagesCount,
        qtd_mensagens_operador: metrics.operatorMessagesCount,
      });
    });

    // Ordenar por data/hora descendente
    result.sort((a, b) => {
      const dateA = `${a.data_envio} ${a.hora_envio}`;
      const dateB = `${b.data_envio} ${b.hora_envio}`;
      return dateB.localeCompare(dateA);
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE INDICADORES
   * Estrutura: data, data_envio, inicio_atendimento, fim_atendimento, tma, tipo_atendimento,
   * fornecedor, codigo_carteira, carteira, segmento, contrato, cpf, telefone, status,
   * login, evento, evento_normalizado, envio, falha, entregue, lido, cpc, cpc_produtivo,
   * boleto, valor, transbordo, primeira_opcao_oferta, segunda_via, nota_nps, obs_nps,
   * erro_api, abandono, protocolo
   */
  async getIndicadoresReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "asc" },
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    // Agrupar conversas por contato para calcular TMA
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment
        ? segmentMap.get(firstConv.segment)
        : null;
      const line = firstConv.userLine ? lineMap.get(firstConv.userLine) : null;
      const tabulation = lastConv.tabulation
        ? tabulationMap.get(lastConv.tabulation)
        : null;

      // Calcular TMA (tempo médio de atendimento em minutos)
      const tma =
        convs.length > 1
          ? Math.round(
            (lastConv.datetime.getTime() - firstConv.datetime.getTime()) /
            1000 /
            60,
          )
          : 0;

      result.push({
        data: this.formatDate(firstConv.datetime),
        data_envio: this.formatDate(firstConv.datetime),
        inicio_atendimento: this.formatTime(firstConv.datetime),
        fim_atendimento: this.formatTime(lastConv.datetime),
        tma: tma.toString(),
        tipo_atendimento: firstConv.sender === "operator" ? "1:1" : "Receptivo",
        fornecedor: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        carteira: segment?.name || null,
        segmento: segment?.name || null,
        contrato: contact?.contract || null,
        cpf: contact?.cpf || null,
        telefone: phone,
        status: tabulation ? "Finalizado" : "Em Andamento",
        login: firstConv.userName || null,
        evento: tabulation?.name || null,
        evento_normalizado: tabulation?.name || null,
        envio: "Sim",
        falha: "Não",
        entregue: "Sim",
        lido: null,
        cpc: tabulation?.isCPC ? "Sim" : "Não",
        cpc_produtivo: tabulation?.isCPC ? "Sim" : "Não",
        boleto: tabulation?.isCPC ? "Sim" : "Não",
        valor: null,
        transbordo: null,
        primeira_opcao_oferta: null,
        segunda_via: null,
        nota_nps: null,
        obs_nps: null,
        erro_api: null,
        abandono: !tabulation ? "Sim" : "Não",
        protocolo: null,
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE TEMPOS
   * Estrutura: data, hora, fornecedor, codigo_carteira, carteira, segmento, contrato,
   * cpf, telefone, login, evento, evento_normalizado, tma, tmc, tmpro, tmf, tmrc,
   * tmro, protocolo
   */
  async getTemposReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: [{ contactPhone: "asc" }, { datetime: "asc" }],
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    // Agrupar por contato
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      if (convs.length < 2) return; // Precisa de pelo menos 2 mensagens

      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment
        ? segmentMap.get(firstConv.segment)
        : null;
      const line = firstConv.userLine ? lineMap.get(firstConv.userLine) : null;
      const tabulation = lastConv.tabulation
        ? tabulationMap.get(lastConv.tabulation)
        : null;

      // Calcular tempos em minutos
      const tma = Math.round(
        (lastConv.datetime.getTime() - firstConv.datetime.getTime()) /
        1000 /
        60,
      );

      result.push({
        data: this.formatDate(firstConv.datetime),
        hora: this.formatTime(firstConv.datetime),
        fornecedor: line?.evolutionName || null,
        codigo_carteira: segment?.id || null,
        carteira: segment?.name || null,
        segmento: segment?.name || null,
        contrato: contact?.contract || null,
        cpf: contact?.cpf || null,
        telefone: phone,
        login: firstConv.userName || null,
        evento: tabulation?.name || null,
        evento_normalizado: tabulation?.name || null,
        tma: tma.toString(),
        tmc: null, // Tempo médio de conversação
        tmpro: null, // Tempo médio de processamento
        tmf: null, // Tempo médio de fila
        tmrc: null, // Tempo médio de resposta do contato
        tmro: null, // Tempo médio de resposta do operador
        protocolo: null,
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE TEMPLATES
   * Estrutura: Data de Solicitação de Envio, Canal, Fornecedor, Nome do Template,
   * Conteúdo do Disparo Inicial, Carteira, WhatsApp Saída, Quantidade de Disparos,
   * Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getTemplatesReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    // Agrupar por nome do template para contar disparos
    const templateGroups: Record<string, any[]> = {};
    campaigns.forEach((campaign) => {
      if (!templateGroups[campaign.name]) {
        templateGroups[campaign.name] = [];
      }
      templateGroups[campaign.name].push(campaign);
    });

    const result: any[] = [];

    Object.entries(templateGroups).forEach(
      ([templateName, templateCampaigns]) => {
        const firstCampaign = templateCampaigns[0];
        const segment = firstCampaign.contactSegment
          ? segmentMap.get(firstCampaign.contactSegment)
          : null;
        const line = firstCampaign.lineReceptor
          ? lineMap.get(firstCampaign.lineReceptor)
          : null;

        // Verificar se houve retorno (se alguma campanha teve resposta)
        const teveRetorno = templateCampaigns.some((c) => c.response);
        const enviado = templateCampaigns.length > 0;
        const confirmado = templateCampaigns.some((c) => c.response);
        const falha = templateCampaigns.some((c) => c.retryCount > 0);

        result.push({
          "Data de Solicitação de Envio": this.formatDate(
            firstCampaign.createdAt,
          ),
          Canal: line?.oficial ? "Oficial" : "Não Oficial",
          Fornecedor: "Tatica Atendimentos",
          "Nome do Template": templateName,
          "Conteúdo do Disparo Inicial": null, // Não temos mensagem na campanha, seria necessário adicionar
          Carteira: segment?.name || null,
          "WhatsApp Saída": line?.phone || null,
          "Quantidade de Disparos": templateCampaigns.length,
          Enviado: enviado ? "Sim" : "Não",
          Confirmado: confirmado ? "Sim" : "Não",
          Leitura: null, // Não temos informação de leitura
          Falha: falha ? "Sim" : "Não",
          Interação: teveRetorno ? "Sim" : "Não",
        });
      },
    );

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO COMPLETO CSV
   * Estrutura: Id, Carteira, Nome do Cliente, Telefone, CNPJ/CPF, Contrato,
   * Nome do Operador, Tabulação, Status, Primeiro Atendimento, Último Atendimento,
   * Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getCompletoCsvReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "asc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    // Agrupar por contato para pegar primeiro e último atendimento
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment
        ? segmentMap.get(firstConv.segment)
        : null;
      const tabulation = lastConv.tabulation
        ? tabulationMap.get(lastConv.tabulation)
        : null;

      // Verificar se houve interação (resposta do cliente)
      const teveInteracao = convs.some((c) => c.sender === "contact");
      const enviado = convs.some((c) => c.sender === "operator");
      const confirmado = enviado; // Assumindo que se foi enviado, foi confirmado

      result.push({
        Id: firstConv.id,
        Carteira: segment?.name || null,
        "Nome do Cliente": firstConv.contactName,
        Telefone: phone,
        "CNPJ/CPF": contact?.cpf || null,
        Contrato: contact?.contract || null,
        "Nome do Operador": firstConv.userName || null,
        Tabulação: tabulation?.name || null,
        Status: tabulation ? "Finalizado" : "Em Andamento",
        "Primeiro Atendimento": this.formatDate(firstConv.datetime),
        "Último Atendimento": this.formatDate(lastConv.datetime),
        Enviado: enviado ? "Sim" : "Não",
        Confirmado: confirmado ? "Sim" : "Não",
        Leitura: null,
        Falha: "Não",
        Interação: teveInteracao ? "Sim" : "Não",
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE EQUIPE
   * Estrutura: id, Operador, Quantidade de Mensagens, Carteira
   */
  async getEquipeReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {
      sender: "operator",
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const users = await this.prisma.user.findMany({
      where: {
        role: "operator",
        email: {
          endsWith: "@paschoalotto.com.br",
          not: {
            contains: this.internalEmailMarker,
          },
        },
      },
    });
    const userMap = new Map(users.map((u) => [u.name, u]));

    // Agrupar por operador
    const operatorGroups: Record<string, { count: number; segment?: number }> =
      {};

    conversations.forEach((conv) => {
      if (!conv.userName) return;

      const key = conv.userName;
      if (!operatorGroups[key]) {
        operatorGroups[key] = { count: 0, segment: conv.segment || undefined };
      }
      operatorGroups[key].count++;
    });

    const result: any[] = [];

    Object.entries(operatorGroups).forEach(([userName, data]) => {
      const user = userMap.get(userName);
      const segment = data.segment ? segmentMap.get(data.segment) : null;

      result.push({
        id: user?.id || null,
        Operador: userName,
        "Quantidade de Mensagens": data.count,
        Carteira: segment?.name || null,
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE DADOS TRANSACIONADOS
   * Estrutura: id Ticket, id Template, Nome do Template, Mensagem Template,
   * Dispositivo Disparo, Segmento do Dispositivo, E-mail Operador, Data de Disparo,
   * Dispositivo Recebido, Enviado, Confirmado, Leitura, Falha, Interação
   */
  async getDadosTransacionadosReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    const campaigns = await this.prisma.campaign.findMany({
      where: whereClause,
      orderBy: { dateTime: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    const users = await this.prisma.user.findMany({
      where: {
        line: { not: null },
        email: {
          endsWith: "@paschoalotto.com.br",
          not: {
            contains: this.internalEmailMarker,
          },
        },
      },
    });
    const userMap = new Map(
      users.filter((u) => u.line !== null).map((u) => [u.line!, u]),
    );

    // Buscar conversas relacionadas para verificar interação
    const contactPhones = campaigns.map((c) => c.contactPhone);
    const conversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone: { in: contactPhones },
      },
    });

    const contactConvs: Record<string, boolean> = {};
    conversations.forEach((conv) => {
      if (conv.sender === "contact") {
        contactConvs[conv.contactPhone] = true;
      }
    });

    const result = campaigns.map((campaign) => {
      const segment = campaign.contactSegment
        ? segmentMap.get(campaign.contactSegment)
        : null;
      const line = campaign.lineReceptor
        ? lineMap.get(campaign.lineReceptor)
        : null;
      const user = line ? userMap.get(line.id) : null;

      return {
        "id Ticket": campaign.id,
        "id Template": null, // Não temos ID de template separado
        "Nome do Template": campaign.name,
        "Mensagem Template": null, // Não temos mensagem na campanha
        "Dispositivo Disparo": line?.phone || null,
        "Segmento do Dispositivo": segment?.name || null,
        "E-mail Operador": user?.email || null,
        "Data de Disparo": this.formatDate(campaign.dateTime),
        "Dispositivo Recebido": campaign.contactPhone,
        Enviado: "Sim",
        Confirmado: campaign.response ? "Sim" : "Não",
        Leitura: null,
        Falha: campaign.retryCount > 0 ? "Sim" : "Não",
        Interação: contactConvs[campaign.contactPhone] ? "Sim" : "Não",
      };
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DETALHADO DE CONVERSAS
   * Estrutura: Data de Conversa, Protocolo, Login do Operador, CPF/CNPJ, Contrato,
   * Data e Hora início da Conversa, Data e Hora fim da Conversa, Paschoalotto,
   * Telefone do Cliente, Segmento, Hora da Mensagem, Mensagem Transcrita,
   * Quem Enviou a Mensagem, Finalização
   */
  async getDetalhadoConversasReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        whereClause.datetime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.datetime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: [{ datetime: "asc" }],
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    const linesStock = await this.prisma.linesStock.findMany();
    const linesStockMap = new Map(linesStock.map((l) => [l.id, l]));

    // Agrupar por contato para pegar início e fim
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    const sortedContactEntries = Object.entries(contactConvs).sort(
      ([, a], [, b]) =>
        new Date(a[0].datetime).getTime() - new Date(b[0].datetime).getTime(),
    );

    sortedContactEntries.forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment
        ? segmentMap.get(firstConv.segment)
        : null;
      const tabulation = lastConv.tabulation
        ? tabulationMap.get(lastConv.tabulation)
        : null;

      // Criar uma linha para cada mensagem
      convs.forEach((conv) => {
        const line = conv.userLine ? linesStockMap.get(conv.userLine) : null;
        result.push({
          "Data de Conversa": this.formatDate(firstConv.datetime),
          Protocolo: firstConv.id,
          "Login do Operador": conv.userName || null,
          "CPF/CNPJ": contact?.cpf || null,
          Contrato: contact?.contract || null,
          "Data e Hora início da Conversa": `${this.formatDate(
            firstConv.datetime,
          )} ${this.formatTime(firstConv.datetime)}`,
          "Data e Hora fim da Conversa": `${this.formatDate(
            lastConv.datetime,
          )} ${this.formatTime(lastConv.datetime)}`,
          Paschoalotto: "Paschoalotto",
          "Telefone do Cliente": phone,
          Segmento: segment?.name || null,
          "Hora da Mensagem": this.formatTime(conv.datetime),
          "Mensagem Transcrita": conv.message,
          "Quem Enviou a Mensagem":
            conv.sender === "operator" ? "Operador" : "Cliente",
          Finalização: tabulation?.name || null,
          numero_saida: line?.realNumber || null,
        });
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE LINHAS
   * Estrutura padrão exigida pelo cliente:
   * - Carteira (segmento)
   * - Número
   * - Blindado (sim/não - baseado em lineStatus 'ban')
   * - Data de Transferência (data da última movimentação)
   *
   * Só entram linhas que já possuem firstTransferAt (já foram transferidas).
   * Filtro de data: baseado em firstTransferAt (quando informado).
   */
  async getLinhasReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    console.log("[Reports] getLinhasReport - Filtros recebidos:", {
      startDate: filters.startDate,
      endDate: filters.endDate,
      segment: filters.segment,
    });

    // Buscar segmento "Padrão" para excluí-lo
    const padraoSegment = await this.prisma.segment.findUnique({
      where: { name: "Padrão" },
    });

    // Apenas linhas que já possuem firstTransferAt (já foram transferidas)
    // Filtro de data: firstTransferAt dentro do período selecionado
    const whereClause: any = {
      // Excluir segmento "Padrão"
      ...(padraoSegment && { segment: { not: padraoSegment.id } }),
      // Linhas sem firstTransferAt não aparecem no relatório
      firstTransferAt: { not: null },
    };

    // Se houver filtro de segmento específico, usar esse
    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    // Filtro de datas: firstTransferAt no período
    if (filters.startDate || filters.endDate) {
      const startDate = filters.startDate
        ? new Date(`${filters.startDate}T00:00:00.000Z`)
        : new Date("2000-01-01");
      const endDate = filters.endDate
        ? new Date(`${filters.endDate}T23:59:59.999Z`)
        : new Date("2100-01-01");
      whereClause.firstTransferAt = {
        ...whereClause.firstTransferAt,
        gte: startDate,
        lte: endDate,
      };
    }

    // Aplicar filtro de identificador (cliente/proprietário)
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "line",
    );

    // Buscar linhas
    let lines = await this.prisma.linesStock.findMany({
      where: finalWhereClause,
      orderBy: { updatedAt: "asc" },
    });

    console.log(
      `[Reports] Total de linhas candidatas (por data de atualização): ${lines.length}`,
    );

    // FILTRO DE "PRIMEIRA VEZ": Remover linhas que já foram alocadas antes do período
    if (filters.startDate && lines.length > 0) {
      const startDate = new Date(`${filters.startDate}T00:00:00.000Z`);
      const filteredLines: any[] = [];

      for (const line of lines) {
        // Verificar se houve eventos de alocação ANTES do início do período
        // O usuário quer ver apenas linhas que foram alocadas pela PRIMEIRA vez no período selecionado
        const previousAllocation = await (
          this.prisma as any
        ).systemEvent.findFirst({
          where: {
            type: { in: ["line_assigned", "line_reallocated"] },
            createdAt: { lt: startDate },
            OR: [
              { data: { contains: `"lineId":${line.id}` } },
              { data: { contains: `"newLineId":${line.id}` } },
            ],
          },
          select: { id: true },
        });

        // Se NÃO exite alocação anterior, inclui a linha (é a primeira vez)
        if (!previousAllocation) {
          filteredLines.push(line);
        }
      }

      console.log(
        `[Reports] Linhas filtradas (removidas ${lines.length - filteredLines.length} linhas recorrentes): ${filteredLines.length}`,
      );
      lines = filteredLines;
    }

    // Buscar segmentos para mapear nomes
    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s.name]));

    // Ordenar por Data de Transferência (mais velho → mais novo); sem data fica no final
    lines.sort((a, b) => {
      if (!a.firstTransferAt && !b.firstTransferAt) return 0;
      if (!a.firstTransferAt) return 1;
      if (!b.firstTransferAt) return -1;
      return (
        new Date(a.firstTransferAt).getTime() -
        new Date(b.firstTransferAt).getTime()
      );
    });

    // Mapear para formato de saída
    const result = lines.map((line) => {
      const segmentName = line.segment ? segmentMap.get(line.segment) : null;
      let numero = line.realNumber ?? line.phone;
      if (line.realNumber != null) {
        const str = String(line.realNumber).trim();
        if (str.startsWith("55")) {
          numero = str.slice(2).trim();
        }
      }
      return {
        Carteira: this.normalizeText(segmentName) || "Sem segmento",
        Número: numero,
        Blindado: line.lineStatus === "ban" ? "Sim" : "Não",
        "Data de Transferência": this.formatDateTime(line.firstTransferAt),
      };
    });

    // Normalizar todos os campos de texto do resultado
    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE MENSAGENS POR LINHA
   * Estrutura: Número, Carteira, Data (dia), Quantidade de Mensagens
   * Agrupa por linha e por dia
   */
  async getMensagensPorLinhaReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    // Filtrar linhas apenas por segmento (data é irrelevante neste relatório)
    const whereClauseLines: any = {};
    if (filters.segment) {
      whereClauseLines.segment = filters.segment;
    }

    // Buscar linhas filtradas por segmento
    const lines = await this.prisma.linesStock.findMany({
      where: whereClauseLines,
    });
    const lineIds = lines.map((l) => l.id);

    // Buscar todas as campanhas das linhas filtradas (sem filtro de data)
    const finalCampaignWhere = await this.applyIdentifierFilter(
      { lineReceptor: { in: lineIds } },
      userIdentifier,
      "campaign",
    );
    const campaigns = await this.prisma.campaign.findMany({
      where: finalCampaignWhere,
      select: { lineReceptor: true },
    });

    // Buscar todas as conversas das linhas filtradas (sem filtro de data nem de sender)
    const finalConversationWhere = await this.applyIdentifierFilter(
      { userLine: { in: lineIds } },
      userIdentifier,
      "conversation",
    );
    const conversations = await this.prisma.conversation.findMany({
      where: finalConversationWhere,
      select: { userLine: true },
    });

    // Buscar segmentos para mapeamento de nomes
    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    // Contar total de mensagens por linha (campanhas + conversas, qualquer remetente)
    const messageCountPerLine = new Map<number, number>();
    for (const c of campaigns) {
      if (c.lineReceptor) {
        messageCountPerLine.set(
          c.lineReceptor,
          (messageCountPerLine.get(c.lineReceptor) ?? 0) + 1,
        );
      }
    }
    for (const c of conversations) {
      if (c.userLine) {
        messageCountPerLine.set(
          c.userLine,
          (messageCountPerLine.get(c.userLine) ?? 0) + 1,
        );
      }
    }

    // Construir resultado: uma linha por número, apenas onde há mensagens (>= 1)
    const result = lines
      .filter((line) => (messageCountPerLine.get(line.id) ?? 0) >= 1)
      .map((line) => {
        const segment = line.segment ? segmentMap.get(line.segment) : null;
        return {
          Número: line.phone,
          Carteira: this.normalizeText(segment?.name) || "Sem segmento",
          "Quantidade de Mensagens": messageCountPerLine.get(line.id)!,
        };
      })
      .sort(
        (a, b) =>
          a.Carteira.localeCompare(b.Carteira) ||
          a.Número.localeCompare(b.Número),
      );

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE USUÁRIOS
   * Estrutura: Nome, E-mail, Segmento, Carteira, Login principal
   */
  async getUsuariosReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {
      email: {
        endsWith: "@paschoalotto.com.br",
        not: {
          contains: this.internalEmailMarker,
        },
      },
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "user",
    );

    const users = await this.prisma.user.findMany({
      where: finalWhereClause,
      orderBy: { name: "asc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const result = users.map((user) => {
      const segment = user.segment ? segmentMap.get(user.segment) : null;
      const segmentName = this.normalizeText(segment?.name) || "Sem segmento";

      // Transformar role: se role !== 'operator' → "sim", se role === 'operator' → "não"
      const loginPrincipal = user.role !== "operator" ? "sim" : "não";

      return {
        Nome: this.normalizeText(user.name),
        "E-mail": this.normalizeText(user.email),
        Segmento: segmentName,
        Carteira: segmentName, // Mesmo valor de Segmento
        "Login principal": loginPrincipal,
      };
    });

    // Ordenar por segmento (alfabético) e depois por nome
    result.sort((a, b) => {
      // Primeiro ordenar por segmento (case-insensitive)
      const segmentCompare = a.Segmento.toLowerCase().localeCompare(
        b.Segmento.toLowerCase(),
      );
      if (segmentCompare !== 0) {
        return segmentCompare;
      }
      // Se segmento igual, ordenar por nome (case-insensitive)
      return a.Nome.toLowerCase().localeCompare(b.Nome.toLowerCase());
    });

    // Normalizar todos os campos de texto do resultado
    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO RESUMO DE ATENDIMENTOS
   * Estrutura: Data Início Conversa, Data de Início da Conversa, Teve Retorno,
   * Telefone do Cliente, Login do Operador, CPF/CNPJ, Contrato,
   * Data e Hora ínicio da Conversa, Data e hora fim da Conversa, Finalização,
   * Segmento, Carteira, Protocolo
   */
  async getResumoAtendimentosReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    console.log(
      "📊 [Reports] Gerando Resumo Atendimentos com filtros:",
      JSON.stringify(filters),
    );

    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.datetime = {};
      if (filters.startDate) {
        // Adicionar hora 00:00:00 para incluir todo o dia
        whereClause.datetime.gte = new Date(
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        // Adicionar hora 23:59:59 para incluir todo o dia
        whereClause.datetime.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
    }

    // Aplicar filtro de identificador
    const finalWhereClause = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "conversation",
    );

    console.log("📊 [Reports] Where clause:", JSON.stringify(finalWhereClause));

    const conversations = await this.prisma.conversation.findMany({
      where: finalWhereClause,
      orderBy: { datetime: "asc" },
    });

    console.log(`📊 [Reports] Encontradas ${conversations.length} conversas`);

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    // Agrupar por contato
    const contactConvs: Record<string, any[]> = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = [];
      }
      contactConvs[conv.contactPhone].push(conv);
    });

    const result: any[] = [];

    Object.entries(contactConvs).forEach(([phone, convs]) => {
      const firstConv = convs[0];
      const lastConv = convs[convs.length - 1];
      const contact = contactMap.get(phone);
      const segment = firstConv.segment
        ? segmentMap.get(firstConv.segment)
        : null;
      const tabulation = lastConv.tabulation
        ? tabulationMap.get(lastConv.tabulation)
        : null;

      // Verificar se teve retorno (resposta do cliente)
      const teveRetorno = convs.some((c) => c.sender === "contact");

      result.push({
        "Data/Hora Início": this.formatDateTime(firstConv.datetime), // Consolidado: era 3 colunas antes
        "Data/Hora Fim": this.formatDateTime(lastConv.datetime),
        "Teve Retorno": teveRetorno ? "Sim" : "Não",
        "Telefone do Cliente": phone,
        "Login do Operador": firstConv.userName || "Sem operador",
        "CPF/CNPJ": contact?.cpf || "N/A",
        Contrato: contact?.contract || "N/A",
        Finalização: tabulation?.name || "Sem finalização",
        Segmento: segment?.name || "Sem segmento",
        Carteira: segment?.name || "Sem carteira",
        Protocolo: firstConv.id,
      });
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO HIPERPERSONALIZADO
   * Estrutura: Data de Disparo, Nome do Template, Protocolo, Segmento,
   * Login do Operador, Número de Saída, CPF do Cliente, Telefone do Cliente,
   * Finalização, Disparo, Falha, Entrega, Retorno
   */
  async getHiperPersonalizadoReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.contactSegment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.dateTime = {};
      if (filters.startDate) {
        whereClause.dateTime.gte = new Date(filters.startDate);
      }
      if (filters.endDate) {
        whereClause.dateTime.lte = new Date(filters.endDate);
      }
    }

    // Aplicar filtro de identificador nas campanhas
    const finalCampaignWhere = await this.applyIdentifierFilter(
      whereClause,
      userIdentifier,
      "campaign",
    );

    const campaigns = await this.prisma.campaign.findMany({
      where: finalCampaignWhere,
      orderBy: { dateTime: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s]));

    const lines = await this.prisma.linesStock.findMany();
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    const users = await this.prisma.user.findMany({
      where: {
        line: { not: null },
        email: {
          endsWith: "@paschoalotto.com.br",
          not: {
            contains: this.internalEmailMarker,
          },
        },
      },
    });
    const userMap = new Map(
      users.filter((u) => u.line !== null).map((u) => [u.line!, u]),
    );

    const contacts = await this.prisma.contact.findMany();
    const contactMap = new Map(contacts.map((c) => [c.phone, c]));

    // Buscar conversas para verificar retorno e finalização
    const contactPhones = campaigns.map((c) => c.contactPhone);
    // Aplicar filtro de identificador nas conversas também
    const conversationWhere = await this.applyIdentifierFilter(
      { contactPhone: { in: contactPhones } },
      userIdentifier,
      "conversation",
    );
    const conversations = await this.prisma.conversation.findMany({
      where: conversationWhere,
    });

    const tabulations = await this.prisma.tabulation.findMany();
    const tabulationMap = new Map(tabulations.map((t) => [t.id, t]));

    const contactConvs: Record<
      string,
      { retorno: boolean; tabulation?: number }
    > = {};
    conversations.forEach((conv) => {
      if (!contactConvs[conv.contactPhone]) {
        contactConvs[conv.contactPhone] = { retorno: false };
      }
      if (conv.sender === "contact") {
        contactConvs[conv.contactPhone].retorno = true;
      }
      if (conv.tabulation) {
        contactConvs[conv.contactPhone].tabulation = conv.tabulation;
      }
    });

    const result = campaigns.map((campaign) => {
      const segment = campaign.contactSegment
        ? segmentMap.get(campaign.contactSegment)
        : null;
      const line = campaign.lineReceptor
        ? lineMap.get(campaign.lineReceptor)
        : null;
      const user = line ? userMap.get(line.id) : null;
      const contact = contactMap.get(campaign.contactPhone);
      const convData = contactConvs[campaign.contactPhone];
      const tabulation = convData?.tabulation
        ? tabulationMap.get(convData.tabulation)
        : null;

      return {
        "Data de Disparo": this.formatDateBrazilian(campaign.createdAt),
        "Nome do Template": campaign.name,
        Protocolo: campaign.id,
        Segmento: segment?.name || null,
        "Login do Operador": user?.email || null,
        "Número de Saída": line?.phone || null,
        "CPF do Cliente": contact?.cpf || null,
        "Telefone do Cliente": campaign.contactPhone,
        Finalização: tabulation?.name || null,
        Disparo: "1",
        Falha: "0",
        Entrega: "1",
        Retorno: convData?.retorno ? "1" : "0",
      };
    });

    return this.normalizeObject(result);
  }

  /**
   * RELATÓRIO DE AUDITORIA DE TRANSFERÊNCIA DE LINHAS
   * Estrutura: Data da Transferência, Telefone / Linha, Nome da Linha, Nova Carteira Destino
   */
  async getAuditoriaLinhasReport(filters: ReportFilterDto) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.companyId = filters.segment; // Filtrar pela carteira destino
    }

    if (filters.startDate || filters.endDate) {
      whereClause.createdAt = {};
      if (filters.startDate) {
        whereClause.createdAt.gte = new Date(`${filters.startDate}T00:00:00.000Z`);
      }
      if (filters.endDate) {
        whereClause.createdAt.lte = new Date(`${filters.endDate}T23:59:59.999Z`);
      }
    }

    const audits = await this.prisma.audTransferLine.findMany({
      where: whereClause,
      include: {
        line: true,
        company: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = audits.map((audit) => ({
      "Data da Transferência": this.formatDateTime(audit.createdAt),
      "Telefone / Linha": audit.line?.phone || "Desconhecido",
      "Nome da Linha": "-",
      "Nova Carteira Destino": audit.company?.name || "Desconhecido",
    }));

    if (result.length === 0) {
      return this.normalizeObject([
        {
          "Data da Transferência": "Nenhum registro encontrado no período selecionado",
          "Telefone / Linha": "",
          "Nome da Linha": "",
          "Nova Carteira Destino": "",
        },
      ]);
    }

    return this.normalizeObject(result);
  }

  // ==================== CUSTOM REPORT BUILDER ====================

  /**
   * Lista de tabelas permitidas para o criador de relatórios
   * IMPORTANTE: Apenas tabelas seguras e sem dados sensíveis
   */
  private readonly ALLOWED_TABLES: Record<
    string,
    { displayName: string; description: string }
  > = {
      User: {
        displayName: "Usuários",
        description: "Dados de operadores e administradores",
      },
      Conversation: {
        displayName: "Conversas",
        description: "Histórico de atendimentos",
      },
      Contact: { displayName: "Contatos", description: "Clientes e leads" },
      LinesStock: { displayName: "Linhas", description: "Linhas WhatsApp" },
      Segment: {
        displayName: "Segmentos",
        description: "Segmentos de atendimento",
      },
      Tabulation: {
        displayName: "Tabulações",
        description: "Tipos de tabulação",
      },
      SystemEvent: {
        displayName: "Eventos do Sistema",
        description: "Log de eventos",
      },
      Template: {
        displayName: "Templates",
        description: "Templates de mensagem",
      },
      Campaign: { displayName: "Campanhas", description: "Campanhas de disparo" },
      CampaignContact: {
        displayName: "Contatos de Campanhas",
        description: "Contatos em campanhas",
      },
      Tag: { displayName: "Tags", description: "Tags de classificação" },
    };

  /**
   * Colunas sensíveis que NÃO devem ser expostas
   */
  private readonly BLOCKED_COLUMNS = [
    "password",
    "token",
    "apikey",
    "secret",
    "key",
  ];

  /**
   * Retorna lista de tabelas disponíveis para relatórios customizados
   */
  async getAvailableTables() {
    return Object.entries(this.ALLOWED_TABLES).map(([name, info]) => ({
      name,
      displayName: info.displayName,
      description: info.description,
    }));
  }

  /**
   * Retorna colunas disponíveis para uma tabela
   */
  async getTableColumns(tableName: string) {
    // Verificar se a tabela está na whitelist
    if (!this.ALLOWED_TABLES[tableName]) {
      throw new Error(`Tabela '${tableName}' não permitida`);
    }

    // Buscar schema da tabela via Prisma introspection
    const schemaQuery = `
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = $1 
      AND table_schema = 'public'
      ORDER BY ordinal_position
    `;

    const columns: any[] = await this.prisma.$queryRawUnsafe(
      schemaQuery,
      tableName,
    );

    // Filtrar colunas bloqueadas
    return columns
      .filter(
        (col) => !this.BLOCKED_COLUMNS.includes(col.column_name.toLowerCase()),
      )
      .map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === "YES",
      }));
  }

  /**
   * Executa query customizada com filtros
   * IMPORTANTE: Usa query parametrizada para prevenir SQL injection
   */
  async executeCustomQuery(
    tableName: string,
    columns: string[],
    filters: Array<{ column: string; operator: string; value: string }>,
    limit: number = 1000,
  ) {
    // 1. Validar tabela
    if (!this.ALLOWED_TABLES[tableName]) {
      throw new Error(`Tabela '${tableName}' não permitida`);
    }

    // 2. Buscar colunas válidas da tabela
    const validColumns = await this.getTableColumns(tableName);
    const columnNames = validColumns.map((c) => c.name);

    // 3. Validar colunas solicitadas
    const safeColumns = columns.filter((col) => columnNames.includes(col));
    if (safeColumns.length === 0) {
      throw new Error("Nenhuma coluna válida selecionada");
    }

    // 4. Construir SELECT seguro (usando aspas duplas para nomes de colunas)
    const selectClause = safeColumns.map((c) => `"${c}"`).join(", ");

    // 5. Construir WHERE com parâmetros
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const filter of filters) {
      // Validar que a coluna existe
      if (!columnNames.includes(filter.column)) {
        continue;
      }

      // Validar operador
      const allowedOperators = [
        "=",
        "!=",
        ">",
        "<",
        ">=",
        "<=",
        "LIKE",
        "ILIKE",
        "IS NULL",
        "IS NOT NULL",
      ];
      if (!allowedOperators.includes(filter.operator.toUpperCase())) {
        continue;
      }

      if (filter.operator.toUpperCase() === "IS NULL") {
        whereConditions.push(`"${filter.column}" IS NULL`);
      } else if (filter.operator.toUpperCase() === "IS NOT NULL") {
        whereConditions.push(`"${filter.column}" IS NOT NULL`);
      } else if (
        filter.operator.toUpperCase() === "LIKE" ||
        filter.operator.toUpperCase() === "ILIKE"
      ) {
        whereConditions.push(
          `"${filter.column}" ${filter.operator.toUpperCase()} $${paramIndex}`,
        );
        params.push(`%${filter.value}%`);
        paramIndex++;
      } else {
        whereConditions.push(
          `"${filter.column}" ${filter.operator} $${paramIndex}`,
        );
        params.push(filter.value);
        paramIndex++;
      }
    }

    // 6. Construir query final
    let query = `SELECT ${selectClause} FROM "${tableName}"`;
    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(" AND ")}`;
    }
    query += ` LIMIT ${Math.min(limit, 10000)}`; // Máximo de 10000 registros

    console.log(`🔍 [CustomReport] Executando: ${query}`);
    console.log(`🔍 [CustomReport] Params:`, params);

    // 7. Executar query
    const results: any[] = await this.prisma.$queryRawUnsafe(query, ...params);

    // 8. Formatar datas
    const formattedResults = results.map((row) => {
      const formatted: any = {};
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) {
          formatted[key] = this.formatDateTime(value);
        } else {
          formatted[key] = value;
        }
      }
      return formatted;
    });

    return {
      query: query.replace(/\$\d+/g, "?"), // Ocultar parâmetros no retorno
      totalRows: formattedResults.length,
      data: formattedResults,
    };
  }

  /**
   * Relatório: Mensagens por Operador
   * Retorna contagem de mensagens enviadas e recebidas por operador
   */
  async getMessagesPerOperatorReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    // 1. Construir cláusula WHERE base
    const whereClause: any = {
      datetime: {
        gte: new Date(`${filters.startDate}T00:00:00`),
        lte: new Date(`${filters.endDate}T23:59:59.999`),
      },
      userId: { not: null }, // Apenas mensagens vinculadas a operadores
      isAdminTest: false,
    };

    // 2. Aplicar filtros adicionais
    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    this.applyIdentifierFilter(whereClause, userIdentifier, "conversation");

    // 3. Buscar TODAS as mensagens (Conversations) no período
    // Solicitado: Uma linha por mensagem
    const conversations = await this.prisma.conversation.findMany({
      where: whereClause,
      select: {
        id: true,
        userId: true,
        userLine: true,
        sender: true,
        datetime: true,
        messageType: true, // Opcional, mas útil para contexto se precisar
        message: true,
      },
      orderBy: { datetime: "desc" },
    });

    // 4. Buscar detalhes dos operadores e das linhas
    const operatorIds = [
      ...new Set(
        conversations.map((s) => s.userId).filter((id) => id !== null),
      ),
    ] as number[];
    const lineIds = [
      ...new Set(
        conversations.map((s) => s.userLine).filter((id) => id !== null),
      ),
    ] as number[];

    const operators = await this.prisma.user.findMany({
      where: { id: { in: operatorIds } },
      select: {
        id: true,
        name: true,
        email: true,
        segment: true,
      },
    });

    const lines = await this.prisma.linesStock.findMany({
      where: { id: { in: lineIds } },
      select: {
        id: true,
        phone: true,
        evolutionName: true,
      },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s.name]));
    const operatorMap = new Map(operators.map((u) => [u.id, u]));
    const lineMap = new Map(lines.map((l) => [l.id, l]));

    // 5. Transformar em dados planos
    // Colunas Solicitadas: Operador, Email, Segmento, Linha, Tipo(recebeu/enviou), Data
    const formattedResults = conversations.map((conv) => {
      const op = operatorMap.get(conv.userId!);
      const line = conv.userLine ? lineMap.get(conv.userLine) : null;
      const segmentName = op?.segment
        ? segmentMap.get(op.segment)
        : "Sem Segmento";

      // Formatar Data (DD/MM/YYYY)
      const dateObj = new Date(conv.datetime);
      const dateStr = dateObj.toLocaleDateString("pt-BR");

      // Traduzir Tipo
      const type = conv.sender === "operator" ? "Enviou" : "Recebeu";

      return {
        Operador: op?.name || `ID ${conv.userId}`,
        Email: op?.email || "",
        Segmento: segmentName,
        "Linha Utilizada": line
          ? `${line.phone} (${line.evolutionName})`
          : conv.userLine
            ? `Linha ID ${conv.userLine}`
            : "N/A",
        Tipo: type,
        Data: dateStr,
        Hora: dateObj.toLocaleTimeString("pt-BR"),
        Conteúdo: (conv.message || "").replace(/[\r\n]+/g, " "),
      };
    });

    return formattedResults;
  }

  /**
   * Relatório: Detalhado de Ativadores (Linhas Criadas)
   * Colunas: Ativador, Linha, Segmento, Data de Criação
   */
  /**
   * Relatório: Mensagens por Usuário
   * Colunas: Nome, E-mail, Segmento, Qtd. Mensagens
   * Lista todos os usuários do segmento filtrado (ou todos) com a contagem de mensagens
   * enviadas como operador no período informado. Inclui usuários com 0 mensagens.
   */
  async getMensagensPorUsuarioReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    // Construir filtro de usuários
    const userWhereClause: any = {
      email: {
        not: { contains: this.internalEmailMarker },
      },
      role: "operator",
    };

    if (filters.segment) {
      userWhereClause.segment = filters.segment;
    }

    await this.applyIdentifierFilter(userWhereClause, userIdentifier, "user");

    // Buscar todos os usuários do segmento
    const users = await this.prisma.user.findMany({
      where: userWhereClause,
      select: { id: true, name: true, email: true, segment: true },
      orderBy: { name: "asc" },
    });

    if (users.length === 0) {
      return [];
    }

    const userIds = users.map((u) => u.id);

    // Construir filtro de conversas (mensagens do operador no período)
    const convWhereClause: any = {
      sender: "operator",
      userId: { in: userIds },
      isAdminTest: false,
    };

    if (filters.startDate || filters.endDate) {
      convWhereClause.datetime = {};
      if (filters.startDate) {
        convWhereClause.datetime.gte = new Date(`${filters.startDate}T00:00:00`);
      }
      if (filters.endDate) {
        convWhereClause.datetime.lte = new Date(`${filters.endDate}T23:59:59.999`);
      }
    }

    // Agrupar contagem de mensagens por userId
    const grouped = await this.prisma.conversation.groupBy({
      by: ["userId"],
      where: convWhereClause,
      _count: { id: true },
    });

    const countMap = new Map(grouped.map((g) => [g.userId, g._count.id]));

    // Buscar segmentos para exibição dos nomes
    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s.name]));

    // Montar resultado final com todos os usuários (inclusive com 0 mensagens)
    const result = users.map((user) => {
      const segmentName = user.segment
        ? segmentMap.get(user.segment) ?? "Sem Segmento"
        : "Sem Segmento";

      return {
        Nome: this.normalizeText(user.name),
        "E-mail": this.normalizeText(user.email),
        Segmento: this.normalizeText(segmentName),
        "Qtd. Mensagens": countMap.get(user.id) ?? 0,
      };
    });

    // Ordenar por segmento e depois por nome
    result.sort((a, b) => {
      const segCmp = a.Segmento.toLowerCase().localeCompare(b.Segmento.toLowerCase());
      if (segCmp !== 0) return segCmp;
      return a.Nome.toLowerCase().localeCompare(b.Nome.toLowerCase());
    });

    return result;
  }

  async getActivatorReport(filters: ReportFilterDto) {
    const whereClause: any = {
      createdAt: {
        gte: new Date(`${filters.startDate}T00:00:00`),
        lte: new Date(`${filters.endDate}T23:59:59.999`),
      },
      createdBy: { not: null }, // Apenas linhas com criador registrado
    };

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    const lines = await this.prisma.linesStock.findMany({
      where: whereClause,
      include: {
        creator: {
          select: { name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s.name]));

    return lines.map((line) => {
      const segmentName = line.segment
        ? segmentMap.get(line.segment)
        : "Sem Segmento";

      return {
        Ativador: line.creator?.name || "Desconhecido",
        Linha: line.phone,
        Segmento: segmentName,
        "Data de Criação":
          new Date(line.createdAt).toLocaleDateString("pt-BR") +
          " " +
          new Date(line.createdAt).toLocaleTimeString("pt-BR"),
        Status: line.lineStatus,
      };
    });
  }

  /**
   * Relatório: Bans por Usuário
   * Colunas: Nome, E-mail, Segmento, Qtd. Bans
   * Lista todos os usuários que tiveram linhas banidas enquanto vinculados a elas,
   * no período e segmento informados. Inclui uma linha para bans sem operador vinculado.
   */
  async getLinhasBanidasPorUsuarioReport(
    filters: ReportFilterDto,
    userIdentifier?: "cliente" | "proprietario",
  ) {
    const whereClause: any = {};

    if (filters.segment) {
      whereClause.segment = filters.segment;
    }

    if (filters.startDate || filters.endDate) {
      whereClause.bannedAt = {};
      if (filters.startDate) {
        whereClause.bannedAt.gte = new Date(`${filters.startDate}T00:00:00`);
      }
      if (filters.endDate) {
        whereClause.bannedAt.lte = new Date(`${filters.endDate}T23:59:59.999`);
      }
    }

    // Agrupar contagem de bans por userId
    const grouped = await this.prisma.lineBanAudit.groupBy({
      by: ["userId"],
      where: whereClause,
      _count: { id: true },
    });

    if (grouped.length === 0) {
      return [];
    }

    // Separar userId nulos dos reais
    const userIds = grouped
      .map((g) => g.userId)
      .filter((id): id is number => id !== null);

    const nullEntry = grouped.find((g) => g.userId === null);

    // Buscar dados dos usuários
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, segment: true },
    });

    const segments = await this.prisma.segment.findMany();
    const segmentMap = new Map(segments.map((s) => [s.id, s.name]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    const result = grouped
      .filter((g) => g.userId !== null)
      .map((g) => {
        const user = userMap.get(g.userId!);
        const segmentName = user?.segment
          ? segmentMap.get(user.segment) ?? "Sem Segmento"
          : "Sem Segmento";

        return {
          Nome: this.normalizeText(user?.name ?? `ID ${g.userId}`),
          "E-mail": this.normalizeText(user?.email ?? ""),
          Segmento: this.normalizeText(segmentName),
          "Qtd. Bans": g._count.id,
        };
      });

    // Ordenar por quantidade de bans (maior primeiro) e depois por nome
    result.sort((a, b) => {
      if (b["Qtd. Bans"] !== a["Qtd. Bans"]) return b["Qtd. Bans"] - a["Qtd. Bans"];
      return a.Nome.toLowerCase().localeCompare(b.Nome.toLowerCase());
    });

    // Adicionar linha de bans sem operador vinculado, se existir
    if (nullEntry) {
      result.push({
        Nome: "Sem operador",
        "E-mail": "-",
        Segmento: "-",
        "Qtd. Bans": nullEntry._count.id,
      });
    }

    return result;
  }
}
