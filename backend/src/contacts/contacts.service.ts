import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { RenameContactDto } from './dto/rename-contact.dto';
import { EvolutionService } from '../evolution/evolution.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';

/**
 * Helper de exibição (Shared Inbox).
 * Prioridade estrita: customTitle > contactName/name (WhatsApp) > "Desconhecido".
 * Use no backend sempre que precisar montar o nome de exibição em respostas.
 */
export function resolveDisplayTitle(
  customTitle?: string | null,
  contactName?: string | null,
): string {
  const trimmedCustom = (customTitle ?? '').trim();
  if (trimmedCustom) return trimmedCustom;
  const trimmedName = (contactName ?? '').trim();
  if (trimmedName) return trimmedName;
  return 'Desconhecido';
}

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private evolutionService: EvolutionService,
    private websocketGateway: WebsocketGateway,
  ) {}

  async create(createContactDto: CreateContactDto) {
    // Criar o contato
    const contact = await this.prisma.contact.create({
      data: createContactDto,
    });

    // Se existe nome, atualizar todas as conversas com "Desconhecido" para este telefone
    if (createContactDto.name && createContactDto.name.trim() !== '') {
      await this.prisma.conversation.updateMany({
        where: {
          contactPhone: contact.phone,
          contactName: 'Desconhecido',
        },
        data: { contactName: createContactDto.name },
      });
    }

    return contact;
  }

  async findAll(search?: string, segment?: number) {
    return this.prisma.contact.findMany({
      where: {
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { cpf: { contains: search } },
          ],
        }),
        ...(segment && { segment }),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
    });

    if (!contact) {
      throw new NotFoundException(`Contato com ID ${id} não encontrado`);
    }

    return contact;
  }

  async findByPhone(phone: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { phone },
    });

    if (!contact) return null;

    if (!contact.profilePicUrl?.trim()) {
      const url = await this.fetchAndPersistProfilePicUrl(phone);
      if (url) {
        return { ...contact, profilePicUrl: url };
      }
    }

    return contact;
  }

  /**
   * Busca foto na Evolution quando ausente no banco e persiste em Contact.
   */
  private async fetchAndPersistProfilePicUrl(
    phone: string,
    instanceName?: string,
  ): Promise<string | null> {
    try {
      const ctx = instanceName
        ? await this.resolveEvolutionForInstance(instanceName)
        : await this.resolveDefaultEvolutionContext();

      if (!ctx) return null;

      const url = await this.evolutionService.fetchProfilePictureUrl(
        ctx.evolution.evolutionUrl,
        ctx.evolution.evolutionKey,
        ctx.apiInstanceName,
        phone,
      );

      if (!url) return null;

      await this.prisma.contact.updateMany({
        where: { phone },
        data: { profilePicUrl: url },
      });

      return url;
    } catch (err: any) {
      console.warn(
        `[Contacts] fetchAndPersistProfilePicUrl falhou para ${phone}: ${err?.message}`,
      );
      return null;
    }
  }

  private async resolveDefaultEvolutionContext() {
    const line = await this.prisma.linesStock.findFirst({
      where: { lineStatus: 'active' },
      orderBy: { id: 'desc' },
    });

    if (!line) return null;

    const apiInstanceName = line.phone.startsWith('line_')
      ? line.phone
      : `line_${line.phone}`;

    try {
      return await this.resolveEvolutionForInstance(apiInstanceName);
    } catch {
      return null;
    }
  }

  async update(id: number, updateContactDto: UpdateContactDto) {
    const contact = await this.findOne(id);

    // Atualizar o contato
    const updatedContact = await this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
    });

    // Se o nome foi alterado, atualizar contactName em todas as conversas relacionadas
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      await this.prisma.conversation.updateMany({
        where: { contactPhone: contact.phone },
        data: { contactName: updateContactDto.name },
      });
    }

    return updatedContact;
  }

  // Atualizar contato por telefone (útil para atualizar durante atendimento)
  async updateByPhone(phone: string, updateContactDto: UpdateContactDto) {
    const contact = await this.findByPhone(phone);
    
    if (!contact) {
      throw new NotFoundException(`Contato com telefone ${phone} não encontrado`);
    }

    // Se marcando como CPC, atualizar lastCPCAt
    if (updateContactDto.isCPC === true) {
      (updateContactDto as any).lastCPCAt = new Date();
    } else if (updateContactDto.isCPC === false) {
      (updateContactDto as any).lastCPCAt = null;
    }

    // Se o nome está sendo atualizado, marcar como manual para evitar sobrescrita automática
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      (updateContactDto as any).isNameManual = true;
    }

    // Atualizar o contato
    const updatedContact = await this.prisma.contact.update({
      where: { id: contact.id },
      data: updateContactDto,
    });

    // Se o nome foi alterado, atualizar contactName em todas as conversas relacionadas
    if (updateContactDto.name !== undefined && updateContactDto.name !== contact.name) {
      await this.prisma.conversation.updateMany({
        where: { contactPhone: phone },
        data: { contactName: updateContactDto.name },
      });
    }

    return updatedContact;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.contact.delete({
      where: { id },
    });
  }

  /**
   * Renomeia manualmente um contato/grupo (Shared Inbox de Número Único).
   *
   * - Cria o contato se ele ainda não existir (caso comum: 1ª mensagem de um
   *   grupo recém-aberto pode chegar antes de qualquer CRUD).
   * - Persiste `customTitle` e marca `isNameManual = true` para travar
   *   sobrescrita automática vinda da Evolution API / webhook.
   * - Propaga o título para `Conversation.contactName` de TODAS as conversas
   *   daquele telefone, garantindo que o histórico exiba o novo nome.
   */
  async rename(phone: string, dto: RenameContactDto) {
    const customTitle = dto.customTitle.trim();
    if (!customTitle) {
      throw new NotFoundException(`Título inválido`);
    }

    const existing = await this.prisma.contact.findFirst({ where: { phone } });

    const contact = existing
      ? await this.prisma.contact.update({
          where: { id: existing.id },
          data: { customTitle, isNameManual: true },
        })
      : await this.prisma.contact.create({
          data: {
            phone,
            name: customTitle,
            customTitle,
            isNameManual: true,
          },
        });

    await this.prisma.conversation.updateMany({
      where: { contactPhone: phone },
      data: { contactName: customTitle },
    });

    return {
      ...contact,
      displayTitle: resolveDisplayTitle(contact.customTitle, contact.name),
    };
  }

  /**
   * Alterna fixação da conversa no topo da sidebar (Shared Inbox — global por contato).
   */
  async togglePinByPhone(phone: string) {
    const existing = await this.prisma.contact.findFirst({ where: { phone } });

    const contact = existing
      ? await this.prisma.contact.update({
          where: { id: existing.id },
          data: { isPinned: !existing.isPinned },
        })
      : await this.prisma.contact.create({
          data: {
            phone,
            name: phone,
            isPinned: true,
          },
        });

    this.websocketGateway.emitConversationDisplayNameUpdated({
      contactPhone: phone,
      contactName: contact.name,
      customTitle: contact.customTitle,
      isPinned: contact.isPinned,
    });

    return {
      ...contact,
      displayTitle: resolveDisplayTitle(contact.customTitle, contact.name),
    };
  }

  /**
   * Sincroniza em lote nomes reais de grupos antigos via Evolution API.
   * Alvo: contatos @g.us cujo name ainda é JID genérico ou "Grupo …".
   */
  async syncOldGroupNames(instanceName: string) {
    const { evolution, apiInstanceName } =
      await this.resolveEvolutionForInstance(instanceName);

    const staleGroups = await this.prisma.contact.findMany({
      where: {
        phone: { endsWith: '@g.us' },
        isNameManual: false,
        customTitle: null,
        OR: [
          { name: { contains: '@g.us' } },
          { name: { startsWith: 'Grupo ' } },
        ],
      },
      orderBy: { id: 'asc' },
    });

    const result = {
      instanceName: apiInstanceName,
      total: staleGroups.length,
      updated: 0,
      skipped: 0,
      failed: 0,
      items: [] as Array<{
        phone: string;
        previousName: string;
        newName?: string;
        status: 'updated' | 'skipped' | 'failed';
        reason?: string;
      }>,
    };

    for (const contact of staleGroups) {
      try {
        const meta = await this.evolutionService.getGroupMetadata(
          evolution.evolutionUrl,
          evolution.evolutionKey,
          apiInstanceName,
          contact.phone,
        );

        const subject = meta?.subject?.trim();
        if (!subject || this.looksLikeGenericGroupName(subject)) {
          result.skipped += 1;
          result.items.push({
            phone: contact.phone,
            previousName: contact.name,
            status: 'skipped',
            reason: subject
              ? 'subject ainda genérico ou inválido'
              : 'Evolution não retornou subject',
          });
        } else if (subject === contact.name) {
          result.skipped += 1;
          result.items.push({
            phone: contact.phone,
            previousName: contact.name,
            newName: subject,
            status: 'skipped',
            reason: 'nome já atualizado',
          });
        } else {
          const updated = await this.prisma.contact.update({
            where: { id: contact.id },
            data: { name: subject },
          });

          await this.prisma.conversation.updateMany({
            where: { contactPhone: contact.phone },
            data: { contactName: subject },
          });

          this.websocketGateway.emitConversationDisplayNameUpdated({
            contactPhone: contact.phone,
            contactName: updated.name,
            customTitle: updated.customTitle,
          });

          result.updated += 1;
          result.items.push({
            phone: contact.phone,
            previousName: contact.name,
            newName: subject,
            status: 'updated',
          });
        }
      } catch (err: any) {
        result.failed += 1;
        result.items.push({
          phone: contact.phone,
          previousName: contact.name,
          status: 'failed',
          reason: err?.message || 'erro desconhecido',
        });
      }

      await this.sleep(750);
    }

    return result;
  }

  private looksLikeGenericGroupName(name?: string | null): boolean {
    if (!name || typeof name !== 'string') return true;
    const t = name.trim();
    if (!t) return true;
    return t.includes('@g.us') || t.startsWith('Grupo ');
  }

  private async resolveEvolutionForInstance(instanceName: string) {
    const normalized = instanceName.trim();
    const phoneNumber = normalized.replace(/^line_/, '');

    const line = await this.prisma.linesStock.findFirst({
      where: {
        OR: [
          { phone: normalized },
          { phone: phoneNumber },
          { phone: { endsWith: phoneNumber } },
          { evolutionName: normalized },
        ],
      },
      orderBy: { id: 'desc' },
    });

    if (!line) {
      throw new NotFoundException(
        `Linha/instância não encontrada para: ${instanceName}`,
      );
    }

    const evolution = await this.prisma.evolution.findUnique({
      where: { evolutionName: line.evolutionName },
    });

    if (!evolution) {
      throw new NotFoundException(
        `Evolution não configurada: ${line.evolutionName}`,
      );
    }

    return {
      evolution,
      apiInstanceName: normalized,
      line,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
