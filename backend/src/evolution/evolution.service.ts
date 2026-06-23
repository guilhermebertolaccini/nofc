import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateEvolutionDto } from './dto/create-evolution.dto';
import { UpdateEvolutionDto } from './dto/update-evolution.dto';
import axios from 'axios';

export interface GroupMetadataResult {
  /** Nome exibido do grupo (WhatsApp subject) */
  subject: string | null;
  id?: string;
}

@Injectable()
export class EvolutionService {
  constructor(private prisma: PrismaService) { }

  async create(createEvolutionDto: CreateEvolutionDto) {
    const existing = await this.prisma.evolution.findUnique({
      where: { evolutionName: createEvolutionDto.evolutionName },
    });

    if (existing) {
      throw new ConflictException('Evolution com este nome já existe');
    }

    // Testar conexão com a Evolution API
    try {
      await axios.get(`${createEvolutionDto.evolutionUrl}/manager/getInstances`, {
        headers: {
          'apikey': createEvolutionDto.evolutionKey,
        },
      });
    } catch (error) {
      throw new Error('Não foi possível conectar à Evolution API. Verifique a URL e a chave.');
    }

    return this.prisma.evolution.create({
      data: createEvolutionDto,
    });
  }

  async findAll() {
    return this.prisma.evolution.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const evolution = await this.prisma.evolution.findUnique({
      where: { id },
    });

    if (!evolution) {
      throw new NotFoundException(`Evolution com ID ${id} não encontrada`);
    }

    return evolution;
  }

  async findByName(evolutionName: string) {
    return this.prisma.evolution.findUnique({
      where: { evolutionName },
    });
  }

  async update(id: number, updateEvolutionDto: UpdateEvolutionDto) {
    await this.findOne(id);

    return this.prisma.evolution.update({
      where: { id },
      data: updateEvolutionDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.evolution.delete({
      where: { id },
    });
  }

  async testConnection(evolutionName: string) {
    const evolution = await this.findByName(evolutionName);

    if (!evolution) {
      throw new NotFoundException('Evolution não encontrada');
    }

    try {
      const response = await axios.get(`${evolution.evolutionUrl}/manager/getInstances`, {
        headers: {
          'apikey': evolution.evolutionKey,
        },
      });

      return {
        success: true,
        message: 'Conexão estabelecida com sucesso',
        instances: response.data,
      };
    } catch (error) {
      throw new Error(`Erro ao conectar: ${error.response?.data?.message || error.message}`);
    }
  }
  async getBase64FromMediaMessage(
    evolutionName: string,
    instanceName: string,
    messageData: any,
    convertToMp4: boolean = false,
  ) {
    const evolution = await this.findByName(evolutionName);

    if (!evolution) {
      console.warn(`Evolution instance '${evolutionName}' not found`);
      return null;
    }

    try {
      const payload = {
        message: messageData,
        convertToMp4,
      };

      const response = await axios.post(
        `${evolution.evolutionUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
        payload,
        {
          headers: {
            apikey: evolution.evolutionKey,
          },
        },
      );

      if (response.data && response.data.base64) {
        return {
          data: response.data.base64,
          mimetype: response.data.mimetype,
        };
      }

      return null;
    } catch (error) {
      console.error(
        `Erro ao buscar Base64 da mídia: ${error.response?.data?.message || error.message}`,
      );
      return null;
    }
  }

  /**
   * Metadados de um grupo WhatsApp (subject = nome real do grupo).
   * Tenta endpoints comuns entre versões da Evolution API.
   * Nunca lança — retorna `null` em falha/timeout.
   */
  async getGroupMetadata(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    groupJid: string,
  ): Promise<GroupMetadataResult | null> {
    const base = evolutionUrl.replace(/\/$/, '');
    const jid = groupJid.includes('@g.us')
      ? groupJid.trim()
      : `${String(groupJid).replace(/\s/g, '')}@g.us`;
    const TIMEOUT_MS = 5000;

    const paths = [
      `/group/findGroupInfos/${instanceName}`,
      `/group/findGroupMetaData/${instanceName}`,
      `/group/metadata/${instanceName}`,
    ];

    for (const path of paths) {
      try {
        const response = await axios.get(`${base}${path}`, {
          params: { groupJid: jid },
          headers: { apikey: evolutionKey },
          timeout: TIMEOUT_MS,
        });

        const raw = response.data;
        const nested =
          raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object'
            ? raw.data
            : null;

        const subject =
          (typeof raw?.subject === 'string' && raw.subject.trim()) ||
          (typeof nested?.subject === 'string' && nested.subject.trim()) ||
          null;

        if (subject) {
          return {
            subject,
            id:
              (typeof raw?.id === 'string' && raw.id) ||
              (typeof nested?.id === 'string' && nested.id) ||
              jid,
          };
        }
      } catch (error: any) {
        const reason =
          error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message)
            ? `timeout (${TIMEOUT_MS}ms)`
            : error?.response?.status
              ? `HTTP ${error.response.status}`
              : error?.message || 'erro';
        console.warn(
          `[Evolution] getGroupMetadata ${path} falhou para ${jid}: ${reason}`,
        );
      }
    }

    return null;
  }

  /**
   * Foto de perfil de contato ou grupo via Evolution API.
   * POST /chat/fetchProfilePictureUrl/{instance} — nunca lança.
   */
  async fetchProfilePictureUrl(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    jidOrPhone: string,
  ): Promise<string | null> {
    const base = evolutionUrl.replace(/\/$/, '');
    const raw = String(jidOrPhone ?? '').trim();
    if (!raw) return null;

    const number = raw.includes('@')
      ? raw
      : `${raw.replace(/\D/g, '')}@s.whatsapp.net`;

    const TIMEOUT_MS = 5000;

    try {
      const response = await axios.post(
        `${base}/chat/fetchProfilePictureUrl/${instanceName}`,
        { number },
        {
          headers: { apikey: evolutionKey },
          timeout: TIMEOUT_MS,
        },
      );

      const data = response.data;
      const nested =
        data && typeof data === 'object' && data.data && typeof data.data === 'object'
          ? data.data
          : null;

      const url =
        (typeof data?.profilePictureUrl === 'string' && data.profilePictureUrl.trim()) ||
        (typeof data?.profilePicUrl === 'string' && data.profilePicUrl.trim()) ||
        (typeof nested?.profilePictureUrl === 'string' &&
          nested.profilePictureUrl.trim()) ||
        (typeof nested?.profilePicUrl === 'string' && nested.profilePicUrl.trim()) ||
        null;

      return url || null;
    } catch (error: any) {
      const reason =
        error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message)
          ? `timeout (${TIMEOUT_MS}ms)`
          : error?.response?.status
            ? `HTTP ${error.response.status}`
            : error?.message || 'erro';
      console.warn(
        `[Evolution] fetchProfilePictureUrl falhou para ${number}: ${reason}`,
      );
      return null;
    }
  }

  /**
   * Envia mensagem de voz (PTT) via Evolution API.
   * POST /message/sendWhatsAppAudio/{instance}
   * `audioUrl` — URL pública acessível pela Evolution (sem base64 local).
   */
  async sendWhatsAppAudio(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    number: string,
    audioUrl: string,
  ) {
    const base = evolutionUrl.replace(/\/$/, '');
    const cleanNumber = number.includes('@')
      ? number.trim()
      : number.replace(/\D/g, '');

    const payload = {
      number: cleanNumber,
      audio: audioUrl,
      options: {
        ptt: true,
        presence: 'recording',
      },
    };

    return axios.post(
      `${base}/message/sendWhatsAppAudio/${instanceName}`,
      payload,
      {
        headers: { apikey: evolutionKey },
        timeout: 60000,
      },
    );
  }

  /**
   * Encaminha mensagem nativa via Evolution (quando suportado).
   * Tenta rotas/payloads comuns entre versões/forks da API.
   */
  async forwardMessage(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    params: {
      destinationPhone: string;
      sourceRemoteJid: string;
      messageId: string;
      fromMe: boolean;
    },
  ) {
    const base = evolutionUrl.replace(/\/$/, '');
    const isGroup = params.destinationPhone.includes('@g.us');
    const number = isGroup
      ? params.destinationPhone.trim()
      : params.destinationPhone.replace(/\D/g, '');

    const messageKey = {
      remoteJid: params.sourceRemoteJid,
      fromMe: params.fromMe,
      id: params.messageId,
    };

    const bodies = [
      { number, message: { key: messageKey } },
      { number, messageKey },
      {
        number,
        messageId: params.messageId,
        remoteJid: params.sourceRemoteJid,
        fromMe: params.fromMe,
      },
    ];

    const paths = [
      '/message/forwardMessage/',
      '/chat/forwardMessage/',
      '/message/sendForward/',
    ];

    let lastError: any = null;

    for (const path of paths) {
      for (const body of bodies) {
        try {
          return await axios.post(`${base}${path}${instanceName}`, body, {
            headers: { apikey: evolutionKey },
            timeout: 30000,
          });
        } catch (error: any) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error('Evolution API não suporta encaminhamento nativo');
  }

  /**
   * Fallback: reenvia o conteúdo da mensagem para outro contato/grupo.
   */
  async resendMessageContent(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
    destinationPhone: string,
    original: {
      message: string;
      messageType: string;
      mediaUrl?: string | null;
    },
  ) {
    const base = evolutionUrl.replace(/\/$/, '');
    const isGroup = destinationPhone.includes('@g.us');
    const number = isGroup
      ? destinationPhone.trim()
      : destinationPhone.replace(/\D/g, '');

    const appUrl =
      process.env.APP_URL || 'https://api.taticamarketing.com.br';
    const resolvePublicMedia = (mediaUrl?: string | null) => {
      if (!mediaUrl?.trim()) return null;
      const trimmed = mediaUrl.trim();
      if (trimmed.startsWith('http')) return trimmed;
      return `${appUrl}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
    };

    const type = (original.messageType || 'text').toLowerCase();
    const caption = original.message?.trim() || ' ';

    if (type === 'image' && original.mediaUrl) {
      const mediaUrl = resolvePublicMedia(original.mediaUrl);
      return axios.post(
        `${base}/message/sendMedia/${instanceName}`,
        {
          number,
          mediatype: 'image',
          media: mediaUrl,
          caption,
        },
        { headers: { apikey: evolutionKey }, timeout: 60000 },
      );
    }

    if (type === 'video' && original.mediaUrl) {
      const mediaUrl = resolvePublicMedia(original.mediaUrl);
      return axios.post(
        `${base}/message/sendMedia/${instanceName}`,
        {
          number,
          mediatype: 'video',
          media: mediaUrl,
          caption,
        },
        { headers: { apikey: evolutionKey }, timeout: 60000 },
      );
    }

    if (type === 'audio' && original.mediaUrl) {
      const audioUrl = resolvePublicMedia(original.mediaUrl)!;
      return this.sendWhatsAppAudio(
        evolutionUrl,
        evolutionKey,
        instanceName,
        number,
        audioUrl,
      );
    }

    if (type === 'document' && original.mediaUrl) {
      const mediaUrl = resolvePublicMedia(original.mediaUrl);
      return axios.post(
        `${base}/message/sendMedia/${instanceName}`,
        {
          number,
          mediatype: 'document',
          media: mediaUrl,
          fileName: caption !== ' ' ? caption : 'documento',
          caption,
        },
        { headers: { apikey: evolutionKey }, timeout: 60000 },
      );
    }

    if (type === 'sticker' && original.mediaUrl) {
      const mediaUrl = resolvePublicMedia(original.mediaUrl);
      return axios.post(
        `${base}/message/sendMedia/${instanceName}`,
        {
          number,
          mediatype: 'image',
          media: mediaUrl,
        },
        { headers: { apikey: evolutionKey }, timeout: 60000 },
      );
    }

    return axios.post(
      `${base}/message/sendText/${instanceName}`,
      {
        number,
        text: caption,
        options: { delay: 800, linkPreview: false },
      },
      { headers: { apikey: evolutionKey }, timeout: 30000 },
    );
  }

  /**
   * Encerra a sessão WhatsApp de uma instância (logout) sem deletar a instância.
   * Usado para destravar sessões "zumbi" (instância existe mas o WhatsApp caiu)
   * antes de pedir um novo QR Code. Nunca lança — retorna true/false.
   */
  async logoutInstance(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<boolean> {
    const base = evolutionUrl.replace(/\/$/, '');
    try {
      await axios.delete(`${base}/instance/logout/${instanceName}`, {
        headers: { apikey: evolutionKey },
        timeout: 10000,
      });
      console.log(`🔌 [Evolution] logout da instância ${instanceName} OK`);
      return true;
    } catch (error: any) {
      // 404 (instância não existe) ou já deslogada não são erros fatais aqui.
      console.warn(
        `[Evolution] logoutInstance ${instanceName} falhou: ${
          error?.response?.status || error?.message || 'erro'
        }`,
      );
      return false;
    }
  }

  /**
   * Remove a instância por completo na Evolution (DELETE /instance/delete).
   * Usado para garantir credenciais limpas antes de recriar e reparear
   * (quebra loops de connectionReplaced/440). Nunca lança — retorna true/false.
   */
  async deleteInstance(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<boolean> {
    const base = evolutionUrl.replace(/\/$/, '');
    try {
      await axios.delete(`${base}/instance/delete/${instanceName}`, {
        headers: { apikey: evolutionKey },
        timeout: 10000,
      });
      console.log(`🗑️ [Evolution] instância ${instanceName} deletada`);
      return true;
    } catch (error: any) {
      console.warn(
        `[Evolution] deleteInstance ${instanceName} falhou: ${
          error?.response?.status || error?.message || 'erro'
        }`,
      );
      return false;
    }
  }

  /**
   * Reinicia uma instância (restart) — força o Baileys a recriar a conexão.
   * Nunca lança — retorna true/false.
   */
  async restartInstance(
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<boolean> {
    const base = evolutionUrl.replace(/\/$/, '');
    try {
      await axios.post(
        `${base}/instance/restart/${instanceName}`,
        {},
        {
          headers: { apikey: evolutionKey },
          timeout: 10000,
        },
      );
      console.log(`🔄 [Evolution] restart da instância ${instanceName} OK`);
      return true;
    } catch (error: any) {
      console.warn(
        `[Evolution] restartInstance ${instanceName} falhou: ${
          error?.response?.status || error?.message || 'erro'
        }`,
      );
      return false;
    }
  }
}
