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
}
