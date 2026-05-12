import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { ConversationsService } from "../conversations/conversations.service";
import { WebsocketGateway } from "../websocket/websocket.gateway";
import axios from "axios";
import { LinesService } from "../lines/lines.service";
import { MediaService } from "../media/media.service";
import { ControlPanelService } from "../control-panel/control-panel.service";
import { BlocklistService } from "../blocklist/blocklist.service";
import {
  SystemEventsService,
  EventType,
  EventModule,
  EventSeverity,
} from "../system-events/system-events.service";
import * as fs from "fs/promises";
import * as path from "path";

import { EvolutionService } from "../evolution/evolution.service";
import { CpcService } from "../cpc/cpc.service";

@Injectable()
export class WebhooksService {
  private readonly uploadsDir = "./uploads";

  constructor(
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private websocketGateway: WebsocketGateway,
    private linesService: LinesService,
    private mediaService: MediaService,
    private controlPanelService: ControlPanelService,
    private blocklistService: BlocklistService,
    private systemEventsService: SystemEventsService,
    private evolutionService: EvolutionService,
    private cpcService: CpcService,
  ) {}

  async handleEvolutionMessage(data: any) {
    try {
      console.log("📩 Webhook recebido:", JSON.stringify(data, null, 2));

      // Verificar se é uma mensagem recebida
      if (
        data.event === "messages.upsert" ||
        data.event === "MESSAGES_UPSERT"
      ) {
        // Extrair o objeto completo da mensagem (com key, message, pushName, etc)
        const message = data.data || data.message;

        if (!message || !message.key) {
          return { status: "ignored", reason: "No message data or key" };
        }

        // Ignorar mensagens enviadas pelo próprio bot
        if (message.key.fromMe) {
          return { status: "ignored", reason: "Message from self" };
        }

        // Verificar se é mensagem de grupo
        const isGroup = message.key.remoteJid?.includes("@g.us") || false;
        const groupId = isGroup ? message.key.remoteJid : null;

        // Para grupos, extrair informações do grupo e do participante
        let from: string;
        let groupName: string | null = null;
        let participantName: string | null = null;

        if (isGroup) {
          // Em grupos, o remoteJid é o ID do grupo
          from = groupId || "";

          // Para grupos, iniciar com nome padrão e buscar o nome real via Evolution API
          groupName = "Grupo sem nome";

          // O participante que enviou está em message.participant ou message.key.participant
          const participant = message.participant || message.key.participant;
          if (participant) {
            participantName =
              message.pushName ||
              participant
                .replace("@s.whatsapp.net", "")
                .replace("@c.us", "")
                .replace("@lid", "");
          }
          console.log(
            `👥 Mensagem de grupo detectada: ${groupName} (${groupId}), participante: ${participantName}`,
          );
        } else {
          // Extrair número do remetente (remoteJid quando fromMe=false é o remetente)
          from =
            message.key.remoteJid
              ?.replace("@s.whatsapp.net", "")
              ?.replace("@lid", "")
              ?.replace("@c.us", "") || "";
        }

        if (!from) {
          console.warn("⚠️ Webhook sem remoteJid; ignorando.", {
            key: message.key,
          });
          return { status: "ignored", reason: "Missing remoteJid" };
        }

        console.log("📱 Mensagem de:", from, "| fromMe:", message.key.fromMe);

        // Extrair texto da mensagem
        const messageText =
          message.message?.conversation ||
          message.message?.extendedTextMessage?.text ||
          message.message?.imageMessage?.caption ||
          message.message?.videoMessage?.caption ||
          message.message?.documentMessage?.caption ||
          (message.message?.imageMessage ? "Imagem recebida" : undefined) ||
          (message.message?.videoMessage ? "Vídeo recebido" : undefined) ||
          (message.message?.audioMessage ? "Áudio recebido" : undefined) ||
          (message.message?.documentMessage
            ? "Documento recebido"
            : undefined) ||
          "Mensagem recebida";

        console.log("💬 Texto:", messageText);

        const messageType = this.getMessageType(message.message);
        let mediaUrl = this.getMediaUrl(message.message);

        // Buscar a linha que recebeu a mensagem
        const instanceName = data.instance || data.instanceName;
        const phoneNumber = instanceName?.replace("line_", "");

        const line = await this.findLineByPhone(phoneNumber, {
          operators: {
            include: {
              user: true,
            },
          },
        });

        if (!line) {
          console.warn(
            "⚠️ [Webhook] Linha não encontrada para o número:",
            phoneNumber,
          );
          return { status: "ignored", reason: "Line not found" };
        }

        console.log(
          `🔍 [Webhook] Linha encontrada: ID ${line.id}, Phone: ${line.phone}`,
          {
            operadoresVinculados: line.operators.length,
            operadores: line.operators.map((lo) => ({
              userId: lo.userId,
              userName: lo.user.name,
              status: lo.user.status,
              role: lo.user.role,
            })),
          },
        );

        // Processar mídia base64 se a linha tiver receiveMedia ativado
        if (line.receiveMedia && messageType !== "text") {
          console.log("🔍 [Webhook] Tentando extrair mídia Base64...");
          let base64Media = this.extractBase64Media(message.message);

          // Se não encontrou base64 no payload, tentar buscar via API
          if (!base64Media) {
            console.log(
              "⚠️ [Webhook] Base64 não encontrado no payload, tentando buscar via API...",
            );
            const convertToMp4 = messageType === "audio"; // Converter áudio para MP4 se necessário (usualmente true para compatibilidade)

            try {
              // É necessário passar o objeto message completo (que contem key, message, etc) ou apenas key?
              // O método espera messageData. O endpoint da Evolution geralmente aceita o objeto da mensagem ou a key.
              // O payload que o usuário passou tem { message: { key: ... } }.
              // A variável 'message' aqui JÁ È o objeto que contem 'key'.
              // Então passamos 'message' como 'messageData'.
              const apiResponse =
                await this.evolutionService.getBase64FromMediaMessage(
                  line.evolutionName,
                  instanceName,
                  message, // Passando o objeto mensagem completo
                  convertToMp4,
                );

              if (apiResponse) {
                console.log(
                  "✅ [Webhook] Base64 recuperado via API com sucesso",
                );
                base64Media = apiResponse;
              }
            } catch (error) {
              console.error(
                "❌ [Webhook] Erro ao buscar Base64 via API:",
                error.message,
              );
            }
          }

          if (base64Media) {
            console.log(
              "✅ [Webhook] Base64 encontrado/recuperado, mimetype:",
              base64Media.mimetype,
            );
            try {
              const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType, base64Media.mimetype)}`;
              const localFileName = await this.saveBase64Media(
                base64Media.data,
                fileName,
                base64Media.mimetype,
              );

              if (localFileName) {
                mediaUrl = `/media/${localFileName}`;
                console.log("📥 Mídia Base64 salva localmente:", mediaUrl);
              }
            } catch (error) {
              console.error("❌ Erro ao salvar mídia Base64:", error.message);
            }
          } else {
            console.log(
              "⚠️ [Webhook] Base64 não encontrado nem via API, tentando baixar da URL...",
            );
            if (mediaUrl) {
              // Fallback: baixar da URL se não tiver base64
              try {
                const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType)}`;
                const localFileName =
                  await this.mediaService.downloadMediaFromEvolution(
                    mediaUrl,
                    fileName,
                  );

                if (localFileName) {
                  mediaUrl = `/media/${localFileName}`;
                  console.log("📥 Mídia URL salva localmente:", mediaUrl);
                }
              } catch (error) {
                console.error("❌ Erro ao baixar mídia:", error.message);
              }
            } else {
              console.warn("⚠️ [Webhook] Nenhuma URL de mídia encontrada");
            }
          }
        } else if (mediaUrl && messageType !== "text") {
          // Se não tem receiveMedia mas tem mídia por URL, tentar baixar
          console.log(
            "📥 [Webhook] Baixando mídia da URL (receiveMedia desativado):",
            mediaUrl,
          );
          try {
            const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType)}`;
            const localFileName =
              await this.mediaService.downloadMediaFromEvolution(
                mediaUrl,
                fileName,
              );

            if (localFileName) {
              mediaUrl = `/media/${localFileName}`;
              console.log("📥 Mídia salva localmente:", mediaUrl);
            }
          } catch (error) {
            console.error("❌ Erro ao baixar mídia:", error.message);
          }
        }

        // Para grupos, usar groupId como identificador; para contatos individuais, usar o número
        const contactIdentifier = isGroup ? groupId || from : from;

        // ─────────────────────────────────────────────────────────────────
        // SHARED INBOX – Resolução robusta do nome do grupo
        // -----------------------------------------------------------------
        // Política: o webhook NUNCA deve descartar uma mensagem por causa
        // do nome do grupo. A cascata abaixo garante que `groupName`
        // sempre tenha um valor utilizável antes do upsert do Contact.
        //
        // Cascata (PARA GRUPOS):
        //   1. Contact.customTitle  → nome manual do operador (Shared Inbox)
        //   2. Contact.name         → nome já em cache no banco (decente)
        //   3. Evolution API        → fetchGroupName(...) com timeout 5s
        //   4. Fallback determinístico → "Grupo <últimos6digitos>"
        //
        // Para 1x1, nenhuma chamada externa é feita.
        // ─────────────────────────────────────────────────────────────────

        // Lookup adiantado: o mesmo objeto é reaproveitado no upsert abaixo.
        let contact = await this.prisma.contact.findFirst({
          where: { phone: contactIdentifier },
        });

        const hasDecentCachedName = (name?: string | null) =>
          !!name &&
          name.trim() !== "" &&
          name.trim() !== "Grupo sem nome" &&
          name.trim() !== "Desconhecido";

        if (isGroup && groupId) {
          // (1) customTitle do banco — fonte de verdade no Shared Inbox
          if (contact?.customTitle && contact.customTitle.trim()) {
            groupName = contact.customTitle.trim();
            console.log(
              `📌 [Webhook] Reusando customTitle do contato (skip Evolution): ${groupName}`,
            );
          }
          // (2) name em cache no banco
          else if (hasDecentCachedName(contact?.name)) {
            groupName = contact!.name.trim();
            console.log(
              `📌 [Webhook] Reusando contact.name em cache (skip Evolution): ${groupName}`,
            );
          }
          // (3) Evolution API com timeout curto (NUNCA aborta)
          else {
            try {
              const evolution = await this.prisma.evolution.findUnique({
                where: { evolutionName: line.evolutionName },
              });
              if (evolution) {
                const realGroupName = await this.fetchGroupName(
                  groupId,
                  evolution.evolutionUrl,
                  evolution.evolutionKey,
                  instanceName,
                );
                if (realGroupName && realGroupName.trim()) {
                  groupName = realGroupName.trim();
                  console.log(
                    `✅ [Webhook] Nome do grupo via Evolution API: ${groupName}`,
                  );
                }
              }
            } catch (err: any) {
              // Defesa extra: fetchGroupName já trata internamente, mas
              // qualquer exceção no findUnique acima também é absorvida.
              console.warn(
                `⚠️ [Webhook] Erro na resolução do nome do grupo (seguindo com fallback): ${err?.message}`,
              );
            }
          }

          // (4) Fallback determinístico — garante que groupName NUNCA fique
          // vazio/"Grupo sem nome" antes do upsert do Contact.
          if (!groupName || !hasDecentCachedName(groupName)) {
            const rawId = String(groupId).split("@")[0];
            const shortId = rawId.slice(-6);
            groupName = shortId
              ? `Grupo ${shortId}`
              : "Grupo Desconhecido";
            console.log(
              `🪪 [Webhook] Fallback de nome do grupo aplicado: ${groupName}`,
            );
          }
        }

        // ─────────────────────────────────────────────────────────────────
        // Upsert do Contact
        // -----------------------------------------------------------------
        // ⚠️ REMOVIDO o early return `{ status: "ignored", reason:
        //    "Could not fetch group name" }` que existia aqui. Como a
        //    cascata acima GARANTE um groupName válido, este caminho não
        //    pode mais descartar mensagens de grupo silenciosamente.
        // ─────────────────────────────────────────────────────────────────
        if (!contact) {
          contact = await this.prisma.contact.create({
            data: {
              name: isGroup
                ? (groupName as string)
                : message.pushName || from,
              phone: contactIdentifier,
              segment: line.segment,
              isNameManual: false, // Nome vindo do webhook, não é manual
            },
          });
          console.log(
            `✅ [Webhook] Contato criado: ${contact.name} (${contactIdentifier}), IsGroup: ${isGroup}`,
          );
        } else if (
          isGroup &&
          !contact.isNameManual &&
          !contact.customTitle && // Shared Inbox: customTitle trava qualquer auto-update
          hasDecentCachedName(groupName) &&
          contact.name !== groupName
        ) {
          // Se o contato existe, é grupo, NÃO tem nome manual nem customTitle
          // e o nome resolvido é mais "decente" que o atual → atualizar.
          contact = await this.prisma.contact.update({
            where: { id: contact.id },
            data: { name: groupName! },
          });
          console.log(
            `✅ [Webhook] Nome do grupo atualizado automaticamente: ${contact.name} (${contactIdentifier})`,
          );
        } else if (isGroup && (contact.isNameManual || contact.customTitle)) {
          console.log(
            `ℹ️ [Webhook] Grupo ${contactIdentifier} tem nome travado (customTitle/isNameManual), preservando: ${contact.customTitle || contact.name}`,
          );
        }

        // Registrar resposta do cliente (reseta repescagem) - apenas para contatos individuais
        if (!isGroup) {
          await this.controlPanelService.registerClientResponse(from);

          // ─── DUPLO CPC INBOUND ───
          // Se o contato tem CPF e contrato salvos, e o segmento tem duploCpcEnabled,
          // verificar se a mensagem contém confirmação dos 3 dígitos do CPF
          if (contact.cpf && contact.contract && line.segment) {
            try {
              const lineSegment = await this.prisma.segment.findUnique({
                where: { id: line.segment },
              });

              if (lineSegment?.duploCpcEnabled === true) {
                // Extrair APENAS dígitos da mensagem (tolera "1 23", "12 3", "1 e 2 e 3")
                const digitsOnly = messageText.replace(/\D/g, "");
                const cpfDigits = contact.cpf.replace(/\D/g, "");
                const last3Cpf = cpfDigits.slice(-3);
                const cpfConfirmed =
                  digitsOnly === last3Cpf || digitsOnly === cpfDigits;

                if (cpfConfirmed) {
                  console.log(
                    `✅ [CPC] Cliente confirmou CPF (${contact.cpf}) - Registrando acionamento`,
                  );

                  const ok = await this.cpcService.registerAcionamento(
                    contactIdentifier,
                    contact.contract,
                    lineSegment.name,
                  );
                  if (ok) {
                    console.log(
                      `✅ [CPC] Acionamento registrado com sucesso para ${contactIdentifier}`,
                    );
                  } else {
                    console.warn(
                      `⚠️ [CPC] Falha ao registrar acionamento para ${contactIdentifier}`,
                    );
                  }
                }
              }
            } catch (error: any) {
              console.error(
                `❌ [CPC] Erro no processamento inbound CPC:`,
                error.message,
              );
            }
          }
          // ─── FIM DUPLO CPC INBOUND ───
        }

        // Verificar frases de bloqueio automático - apenas para contatos individuais
        let blockedByPhrase = false;
        if (!isGroup) {
          const isBlockPhrase =
            await this.controlPanelService.checkBlockPhrases(
              messageText,
              line.segment,
            );

          if (isBlockPhrase) {
            console.log("🚫 Frase de bloqueio detectada:", messageText);
            blockedByPhrase = true;

            // Adicionar à blocklist
            await this.blocklistService.create({
              name: contact.name,
              phone: from,
              cpf: contact.cpf,
            });

            console.log("✅ Contato adicionado à blocklist:", from);
          }
        }

        // Verificar modo compartilhado
        const controlPanel = await this.controlPanelService.findOne();
        const sharedLineMode = controlPanel?.sharedLineMode ?? false;

        // Distribuir mensagem entre os operadores da linha
        // No modo compartilhado, atribuir para todos os usuários da linha
        let finalOperatorId: number | null = null;

        if (sharedLineMode && isGroup) {
          // No modo compartilhado com grupos, atribuir para o primeiro operador/admin online da linha
          // Mas a mensagem será enviada para todos via WebSocket
          const anyOnlineUser = line.operators.find(
            (lo) =>
              lo.user.status === "Online" &&
              (lo.user.role === "operator" ||
                lo.user.role === "admin" ||
                lo.user.role === "supervisor"),
          );

          if (anyOnlineUser) {
            finalOperatorId = anyOnlineUser.userId;
            console.log(
              `✅ [Webhook] Modo compartilhado: atribuindo grupo para ${anyOnlineUser.user.name} (ID: ${finalOperatorId})`,
            );
          }
        } else if (!isGroup) {
          // Para contatos individuais, usar a lógica normal
          const assignedOperatorId =
            await this.linesService.assignInboundMessageToOperator(
              line.id,
              from,
            );
          console.log(
            `📋 [Webhook] Mensagem de ${from} atribuída ao operador ${assignedOperatorId || "nenhum (sem operadores online)"}`,
          );
          finalOperatorId = assignedOperatorId;
        }

        // Se não encontrou operador, tentar encontrar qualquer operador/admin online da linha
        if (!finalOperatorId && line.operators && line.operators.length > 0) {
          // Buscar qualquer usuário online da linha (operador, admin ou supervisor)
          const anyOnlineUser = line.operators.find(
            (lo) =>
              lo.user.status === "Online" &&
              (lo.user.role === "operator" ||
                lo.user.role === "admin" ||
                lo.user.role === "supervisor"),
          );

          if (anyOnlineUser) {
            finalOperatorId = anyOnlineUser.userId;
            console.log(
              `✅ [Webhook] Atribuindo mensagem a usuário online disponível: ${anyOnlineUser.user.name} (ID: ${finalOperatorId})`,
            );
          } else {
            console.warn(
              `⚠️ [Webhook] Nenhum usuário online encontrado na linha ${line.id} mesmo após verificação de fallback`,
            );
          }
        }

        // Se ainda não encontrou operador online, adicionar à fila de mensagens
        if (!finalOperatorId) {
          console.log(
            `📥 [Webhook] Nenhum operador online, adicionando mensagem à fila...`,
          );

          // Adicionar à fila de mensagens
          await (this.prisma as any).messageQueue.create({
            data: {
              contactPhone: from,
              contactName: contact.name,
              message: messageText,
              messageType,
              mediaUrl,
              segment: line.segment || undefined,
              status: "pending",
            },
          });

          // Registrar evento de mensagem na fila
          await this.systemEventsService.logEvent(
            EventType.MESSAGE_QUEUED,
            EventModule.WEBHOOKS,
            {
              contactPhone: from,
              contactName: contact.name,
              messageType,
              lineId: line.id,
              linePhone: line.phone,
            },
            null,
            EventSeverity.WARNING,
          );

          return {
            status: "queued",
            message: "Mensagem adicionada à fila (nenhum operador online)",
          };
        }

        // Real message timestamp from Evolution API
        const evolutionDatetime =
          (message.messageTimestamp ?? message.key?.messageTimestamp)
            ? new Date(
                Number(
                  message.messageTimestamp ?? message.key?.messageTimestamp,
                ) * 1000,
              )
            : undefined;

        // Criar conversa
        const conversation = await this.conversationsService.create({
          contactName: isGroup ? groupName || contact.name : contact.name, // Para grupos, usar nome do grupo
          contactPhone: from,
          segment: line.segment,
          userName: finalOperatorId
            ? line.operators.find((lo) => lo.userId === finalOperatorId)?.user
                .name || null
            : null,
          userLine: line.id,
          userId: finalOperatorId, // Operador específico que vai atender (ou null se não houver)
          message: messageText,
          sender: "contact",
          messageType,
          mediaUrl,
          isGroup,
          groupId: groupId || undefined,
          groupName: isGroup ? groupName : undefined,
          participantName: isGroup ? participantName : undefined, // Nome de quem enviou no grupo
          datetime: evolutionDatetime,
        });

        // Criar/atualizar vínculo de 24 horas entre conversa e operador (garantia adicional)
        // O vínculo já é criado no assignInboundMessageToOperator, mas garantimos aqui também
        if (finalOperatorId) {
          try {
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24); // Expira em 24 horas

            await (this.prisma as any).conversationOperatorBinding.upsert({
              where: {
                contactPhone_lineId: {
                  contactPhone: from,
                  lineId: line.id,
                },
              },
              update: {
                userId: finalOperatorId,
                expiresAt,
                updatedAt: new Date(),
              },
              create: {
                contactPhone: from,
                lineId: line.id,
                userId: finalOperatorId,
                expiresAt,
              },
            });

            console.log(
              `🔗 [Webhook] Vínculo criado/atualizado: contactPhone=${from}, lineId=${line.id}, userId=${finalOperatorId}, expiresAt=${expiresAt.toISOString()}`,
            );
          } catch (error: any) {
            console.error(
              `❌ [Webhook] Erro ao criar/atualizar vínculo:`,
              error.message,
            );
            // Não lançar erro - vínculo é importante mas não deve quebrar o fluxo
          }
        }

        // Registrar evento de mensagem recebida
        await this.systemEventsService.logEvent(
          EventType.MESSAGE_RECEIVED,
          EventModule.WEBHOOKS,
          {
            contactPhone: from,
            contactName: contact.name,
            messageType,
            userId: finalOperatorId,
            lineId: line.id,
            linePhone: line.phone,
            blockedByPhrase,
          },
          finalOperatorId || undefined,
          blockedByPhrase ? EventSeverity.WARNING : EventSeverity.INFO,
        );

        // Emitir via WebSocket (incluir flag de bloqueio se aplicável)
        const messagePayload = {
          ...conversation,
          blockedByPhrase,
        };

        await this.websocketGateway.emitNewMessage(messagePayload);

        return { status: "success", conversation, blockedByPhrase };
      }

      // Verificar status de conexão
      if (
        data.event === "connection.update" ||
        data.event === "CONNECTION_UPDATE"
      ) {
        const state = data.data?.state || data.state;

        if (state === "close" || state === "DISCONNECTED") {
          const instanceName = data.instance || data.instanceName;
          const phoneNumber = instanceName?.replace("line_", "");

          const line = await this.findLineByPhone(phoneNumber);

          if (line) {
            // Analisar motivo da desconexão para diferenciar banimento de desconexão temporária
            const reason = data.data?.reason || data.reason || "";
            const reasonLower =
              typeof reason === "string"
                ? reason.toLowerCase()
                : String(reason).toLowerCase();

            // Motivos que indicam banimento permanente
            const bannedReasons = [
              "403",
              "conflict",
              "banned",
              "loggedout",
              "logged out",
              "deleted",
            ];
            const isBanned = bannedReasons.some((r) => reasonLower.includes(r));

            console.log(
              `🔌 [Webhook] Linha ${line.phone} desconectada. Motivo: "${reason}" | Banida: ${isBanned}`,
            );

            if (isBanned) {
              // Linha permanentemente banida reportada pela nuvem
              console.warn(
                `🛑 [Webhook] Linha ${line.phone} reportou BANIMENTO. Marcando linha como banida no sistema...`,
              );
              await this.linesService.handleBannedLine(
                line.id,
                "connection-attempt",
              );
              return {
                status: "line_banned_reported",
                lineId: line.id,
                reason,
              };
            } else {
              // Desconexão temporária (timeout, connectionLost, etc.)
              // CORREÇÃO: Não desconectar imediatamente via webhook. Deixar o Monitor verificar.
              console.warn(
                `⚠️ [Webhook] Linha ${line.phone} reportou DESCONEXÃO. Delegando verificação para o Monitor.`,
              );
              // await this.linesService.handleDisconnectedLine(line.id);
              return {
                status: "line_disconnected_reported",
                lineId: line.id,
                reason,
              };
            }
          }

          return { status: "line_not_found", phoneNumber };
        }

        // Linha conectada (QRCODE escaneado)
        if (
          state === "open" ||
          state === "OPEN" ||
          state === "connected" ||
          state === "CONNECTED"
        ) {
          const instanceName = data.instance || data.instanceName;
          const phoneNumber = instanceName?.replace("line_", "");

          const line = await this.findLineByPhone(phoneNumber);

          if (line) {
            // Buscar configuração da Evolution API para importar histórico
            const evolution = await this.prisma.evolution.findUnique({
              where: { evolutionName: line.evolutionName },
            });

            if (evolution) {
              // Importar histórico de conversas em background (não esperar)
              this.importRecentHistory(
                line.id,
                evolution.evolutionUrl,
                evolution.evolutionKey,
                instanceName,
              ).catch((error) => {
                console.error(
                  `❌ [Webhook] Erro ao importar histórico em background:`,
                  error.message,
                );
              });

              console.log(
                `📚 [Webhook] Importação de histórico iniciada em background para linha ${line.phone}`,
              );

              // Buscar número real da linha (ownerJid) em background
              this.linesService
                .fetchRealNumber(
                  line.id,
                  evolution.evolutionUrl,
                  evolution.evolutionKey,
                  instanceName,
                )
                .catch((error) => {
                  console.error(
                    `❌ [Webhook] Erro ao buscar número real em background:`,
                    error.message,
                  );
                });
            }
            // Verificar quantos operadores já estão vinculados à linha
            const currentOperatorsCount = await this.prisma.lineOperator.count({
              where: { lineId: line.id },
            });

            // Buscar configuração do segmento da linha para limite de operadores
            let maxOperatorsPerLine = 2; // Default
            if (line.segment) {
              const lineSegment = await this.prisma.segment.findUnique({
                where: { id: line.segment },
                select: { maxOperatorsPerLine: true },
              });
              if (lineSegment) {
                maxOperatorsPerLine = lineSegment.maxOperatorsPerLine;
              }
            }

            if (currentOperatorsCount < maxOperatorsPerLine) {
              // Verificar se a linha é padrão (segmento "Padrão")
              const defaultSegment = await this.prisma.segment.findUnique({
                where: { name: "Padrão" },
              });

              const isDefaultLine =
                defaultSegment && line.segment === defaultSegment.id;

              let operatorWithoutLine = null;

              if (isDefaultLine) {
                // Linha padrão: buscar qualquer operador online sem linha
                const allOnlineOperators = await this.prisma.user.findMany({
                  where: {
                    role: "operator",
                    status: "Online",
                  },
                });

                // Filtrar apenas os que não têm vínculo com nenhuma linha
                for (const operator of allOnlineOperators) {
                  const hasLine = await this.prisma.lineOperator.findFirst({
                    where: { userId: operator.id },
                  });
                  if (!hasLine && operator.segment) {
                    operatorWithoutLine = operator;
                    break; // Pegar o primeiro disponível com segmento
                  }
                }

                // Se encontrou operador, atualizar segmento da linha para o do operador
                if (operatorWithoutLine && operatorWithoutLine.segment) {
                  const updateData: any = {
                    segment: operatorWithoutLine.segment,
                  };

                  // Se for a primeira atribuição de segmento, registrar
                  if (!line.firstSegmentId) {
                    updateData.firstSegmentId = operatorWithoutLine.segment;
                    updateData.firstTransferAt = new Date();
                  }

                  await this.prisma.linesStock.update({
                    where: { id: line.id },
                    data: updateData,
                  });
                  console.log(
                    `🔄 [Webhook] Linha padrão ${line.phone} atualizada para o segmento ${operatorWithoutLine.segment} do operador ${operatorWithoutLine.name}`,
                  );
                }
              } else {
                // Linha normal: buscar operador do mesmo segmento
                const allOnlineOperators = await this.prisma.user.findMany({
                  where: {
                    role: "operator",
                    status: "Online",
                    segment: line.segment,
                  },
                });

                // Filtrar apenas os que não têm vínculo com nenhuma linha
                for (const operator of allOnlineOperators) {
                  const hasLine = await this.prisma.lineOperator.findFirst({
                    where: { userId: operator.id },
                  });
                  if (!hasLine) {
                    operatorWithoutLine = operator;
                    break; // Pegar o primeiro disponível
                  }
                }
              }

              if (operatorWithoutLine) {
                // Vincular operador à linha usando método com transaction + lock
                try {
                  await this.linesService.assignOperatorToLine(
                    line.id,
                    operatorWithoutLine.id,
                  );

                  console.log(
                    `✅ [Webhook] Linha ${line.phone} vinculada automaticamente ao operador ${operatorWithoutLine.name} (segmento ${line.segment || "sem segmento"})`,
                  );

                  // Notificar via WebSocket
                  this.websocketGateway.emitToUser(
                    operatorWithoutLine.id,
                    "line-assigned",
                    {
                      lineId: line.id,
                      linePhone: line.phone,
                      message: `Você foi vinculado à linha ${line.phone} automaticamente.`,
                    },
                  );
                } catch (error) {
                  console.error(
                    `❌ [Webhook] Erro ao vincular linha ${line.id} ao operador ${operatorWithoutLine.id}:`,
                    error.message,
                  );
                }
              } else {
                console.log(
                  `ℹ️ [Webhook] Linha ${line.phone} conectada, mas nenhum operador online sem linha encontrado${isDefaultLine ? "" : ` no segmento ${line.segment || "sem segmento"}`}`,
                );
              }
            } else {
              console.log(
                `ℹ️ [Webhook] Linha ${line.phone} já possui ${currentOperatorsCount} operadores vinculados (Máximo: ${maxOperatorsPerLine})`,
              );
            }
          }

          return { status: "line_connected", lineId: line?.id };
        }
      }

      return { status: "processed" };
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
      return { status: "error", error: error.message };
    }
  }

  /**
   * Busca o nome real do grupo via Evolution API.
   *
   * IMPORTANTE (Shared Inbox):
   *   Este endpoint da Evolution (`GET /group/fetchAllGroups`) é
   *   notoriamente instável (responde vazio, lento, ou com nome
   *   desatualizado). Por isso aqui aplicamos contrato defensivo:
   *
   *     1. Timeout curto e único (5s). Nada de 2 tentativas com sleep —
   *        no pior caso, o webhook só atrasa 5s e cai no fallback.
   *     2. NUNCA lança. Sempre devolve `string | null`.
   *     3. O caller é responsável por decidir o fallback se receber `null`
   *        (ex.: usar customTitle, contact.name ou "Grupo <id>").
   *
   *   Esta função NUNCA deve causar o descarte da mensagem.
   *
   * @param groupId - ID do grupo (ex: 120363027798409612@g.us)
   * @param evolutionUrl - URL da Evolution API
   * @param evolutionKey - Chave de autenticação
   * @param instanceName - Nome da instância
   * @returns Nome do grupo ou `null` se não encontrar / timeout / erro
   */
  private async fetchGroupName(
    groupId: string,
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<string | null> {
    const TIMEOUT_MS = 5000; // 5s — Shared Inbox SLA-friendly
    try {
      console.log(
        `🔍 [Webhook] Buscando nome do grupo ${groupId} via Evolution API (timeout ${TIMEOUT_MS}ms, tentativa única)...`,
      );

      const response = await axios.get(
        `${evolutionUrl}/group/fetchAllGroups/${instanceName}`,
        {
          headers: { apikey: evolutionKey },
          timeout: TIMEOUT_MS,
        },
      );

      if (Array.isArray(response.data)) {
        const group = response.data.find((g: any) => g.id === groupId);
        const subject = group?.subject?.toString().trim();
        if (subject) {
          console.log(`✅ [Webhook] Nome do grupo encontrado: ${subject}`);
          return subject;
        }
      }

      console.warn(
        `⚠️ [Webhook] Grupo ${groupId} não retornou subject na Evolution API (resposta vazia ou sem match)`,
      );
      return null;
    } catch (error: any) {
      const reason =
        error?.code === "ECONNABORTED" || /timeout/i.test(error?.message)
          ? `timeout (${TIMEOUT_MS}ms)`
          : error?.message || "erro desconhecido";
      console.warn(
        `⚠️ [Webhook] fetchGroupName falhou para ${groupId}: ${reason}. ` +
          `Caller deve aplicar fallback — NUNCA descartar a mensagem.`,
      );
      return null;
    }
  }

  /**
   * Importa histórico de conversas recentes via Evolution API quando QR Code é escaneado
   * @param lineId - ID da linha que foi conectada
   * @param evolutionUrl - URL da Evolution API
   * @param evolutionKey - Chave de autenticação
   * @param instanceName - Nome da instância
   */
  async importRecentHistory(
    lineId: number,
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<void> {
    try {
      console.log(
        `📚 [Webhook] Iniciando importação de histórico para linha ${lineId}...`,
      );

      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
        include: {
          operators: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!line) {
        console.error(`❌ [Webhook] Linha ${lineId} não encontrada`);
        return;
      }

      // Buscar conversas recentes via Evolution API (últimas 20 conversas)
      // Endpoint: /chat/findMessages/${instanceName}
      const response = await axios.post(
        `${evolutionUrl}/chat/findMessages/${instanceName}`,
        {
          limit: 20, // Limitar a 20 conversas mais recentes
        },
        {
          headers: { apikey: evolutionKey },
          timeout: 30000, // 30 segundos de timeout
        },
      );

      if (!response.data || !Array.isArray(response.data)) {
        console.warn(`⚠️ [Webhook] Nenhuma conversa encontrada no histórico`);
        return;
      }

      console.log(
        `📥 [Webhook] ${response.data.length} conversas encontradas no histórico`,
      );

      let imported = 0;
      let skipped = 0;

      // Processar cada conversa
      for (const chat of response.data) {
        try {
          const remoteJid = chat.id || chat.remoteJid;
          if (!remoteJid) continue;

          // Verificar se é grupo
          const isGroup = remoteJid.includes("@g.us");
          const contactPhone = remoteJid
            .replace("@s.whatsapp.net", "")
            .replace("@c.us", "")
            .replace("@lid", "");

          // ───────────────────────────────────────────────────────────
          // SHARED INBOX – Resolução robusta do nome (mesma cascata do
          // MESSAGES_UPSERT). Política: NUNCA descartar mensagem do
          // histórico por causa do nome do grupo / contato.
          //
          // Cascata (PARA GRUPOS):
          //   1. Contact.customTitle    (manual do operador — Shared Inbox)
          //   2. Contact.name           (cache decente no banco)
          //   3. Evolution API          (fetchGroupName c/ timeout 5s)
          //   4. Fallback determinístico ("Grupo <últimos6dígitos>")
          //
          // Para 1x1, o nome vem do chat.name / pushName / phone — sem
          // chamadas externas.
          // ───────────────────────────────────────────────────────────
          const contactIdentifier = isGroup ? remoteJid : contactPhone;

          // Lookup adiantado: reaproveitado no upsert abaixo.
          let contact = await this.prisma.contact.findFirst({
            where: { phone: contactIdentifier },
          });

          const hasDecentCachedName = (name?: string | null) =>
            !!name &&
            name.trim() !== "" &&
            name.trim() !== "Grupo sem nome" &&
            name.trim() !== "Desconhecido";

          let contactName: string =
            chat.name || chat.pushName || contactPhone;

          if (isGroup) {
            let resolvedGroupName: string | null = null;

            // (1) customTitle do banco — fonte de verdade no Shared Inbox
            if (contact?.customTitle && contact.customTitle.trim()) {
              resolvedGroupName = contact.customTitle.trim();
              console.log(
                `📌 [Webhook/History] Reusando customTitle (skip Evolution): ${resolvedGroupName}`,
              );
            }
            // (2) name em cache no banco
            else if (hasDecentCachedName(contact?.name)) {
              resolvedGroupName = contact!.name.trim();
              console.log(
                `📌 [Webhook/History] Reusando contact.name em cache (skip Evolution): ${resolvedGroupName}`,
              );
            }
            // (3) Evolution API com timeout curto (NUNCA aborta)
            else {
              try {
                const apiName = await this.fetchGroupName(
                  remoteJid,
                  evolutionUrl,
                  evolutionKey,
                  instanceName,
                );
                if (apiName && apiName.trim()) {
                  resolvedGroupName = apiName.trim();
                  console.log(
                    `✅ [Webhook/History] Nome do grupo via Evolution API: ${resolvedGroupName}`,
                  );
                }
              } catch (err: any) {
                // Defesa extra: fetchGroupName já trata internamente.
                console.warn(
                  `⚠️ [Webhook/History] Erro na resolução do nome do grupo (seguindo com fallback): ${err?.message}`,
                );
              }
            }

            // (4) Fallback determinístico — NUNCA descarta a mensagem
            if (!resolvedGroupName || !hasDecentCachedName(resolvedGroupName)) {
              const rawId = String(remoteJid).split("@")[0];
              const shortId = rawId.slice(-6);
              resolvedGroupName = shortId
                ? `Grupo ${shortId}`
                : "Grupo Desconhecido";
              console.log(
                `🪪 [Webhook/History] Fallback de nome do grupo aplicado: ${resolvedGroupName}`,
              );
            }

            contactName = resolvedGroupName;
          }

          // ───────────────────────────────────────────────────────────
          // Upsert do Contact
          // ⚠️ NÃO existe early return / continue por falta de nome aqui.
          // Como a cascata acima GARANTE contactName válido, o histórico
          // é sempre persistido com fallback se necessário.
          // ───────────────────────────────────────────────────────────
          if (!contact) {
            contact = await this.prisma.contact.create({
              data: {
                name: contactName,
                phone: contactIdentifier,
                segment: line.segment,
                isNameManual: false,
              },
            });
          } else if (
            isGroup &&
            !contact.isNameManual &&
            !contact.customTitle && // Shared Inbox: customTitle trava auto-update
            hasDecentCachedName(contactName) &&
            contact.name !== contactName
          ) {
            // Atualizar nome apenas se nada está travado e o novo é "decente"
            contact = await this.prisma.contact.update({
              where: { id: contact.id },
              data: { name: contactName },
            });
            console.log(
              `✅ [Webhook/History] Nome do grupo atualizado: ${contact.name} (${contactIdentifier})`,
            );
          }

          // Buscar mensagens da conversa (últimas 10)
          const messagesResponse = await axios.post(
            `${evolutionUrl}/chat/findMessages/${instanceName}`,
            {
              where: {
                key: {
                  remoteJid: remoteJid,
                },
              },
              limit: 10,
            },
            {
              headers: { apikey: evolutionKey },
              timeout: 10000,
            },
          );

          const messages = messagesResponse.data || [];

          // Encontrar operador online para vincular
          const onlineOperator = line.operators.find(
            (lo) =>
              lo.user.status === "Online" &&
              (lo.user.role === "operator" ||
                lo.user.role === "admin" ||
                lo.user.role === "supervisor"),
          );

          const operatorId = onlineOperator?.userId || null;
          const operatorName = onlineOperator?.user.name || null;

          // Importar mensagens
          for (const msg of messages) {
            try {
              // Ignorar mensagens do próprio bot
              if (msg.key?.fromMe) continue;

              const messageText =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                "Mensagem importada";

              const messageType = this.getMessageType(msg.message);
              const sender = msg.key?.fromMe ? "operator" : "contact";
              const datetime = msg.messageTimestamp
                ? new Date(Number(msg.messageTimestamp) * 1000)
                : new Date();

              // Verify if the message already exists by text and datetime
              const existingMessage = await this.prisma.conversation.findFirst({
                where: {
                  contactPhone: isGroup ? remoteJid : contactPhone,
                  userLine: lineId,
                  message: messageText,
                  datetime: {
                    gte: new Date(datetime.getTime() - 1000), // 1 segundo antes
                    lte: new Date(datetime.getTime() + 1000), // 1 segundo depois
                  },
                },
              });

              if (existingMessage) {
                skipped++;
                continue; // Mensagem já existe, pular
              }

              // Criar conversa vinculada ao operador online (se houver)
              await this.conversationsService.create({
                contactName: contactName,
                contactPhone: isGroup ? remoteJid : contactPhone,
                segment: line.segment,
                userName: operatorName,
                userLine: lineId,
                userId: operatorId, // Vincular ao operador online
                message: messageText,
                sender: sender as any,
                messageType,
                isGroup,
                groupId: isGroup ? remoteJid : undefined,
                groupName: isGroup ? contactName : undefined,
                datetime,
              });

              imported++;
            } catch (error: any) {
              console.error(
                `❌ [Webhook] Erro ao importar mensagem:`,
                error.message,
              );
            }
          }
        } catch (error: any) {
          console.error(
            `❌ [Webhook] Erro ao processar conversa:`,
            error.message,
          );
        }
      }

      console.log(
        `✅ [Webhook] Importação concluída: ${imported} mensagens importadas, ${skipped} conversas puladas`,
      );
    } catch (error: any) {
      console.error(`❌ [Webhook] Erro ao importar histórico:`, error.message);
    }
  }

  private getMessageType(message: any): string {
    if (message?.imageMessage) return "image";
    if (message?.videoMessage) return "video";
    if (message?.audioMessage) return "audio";
    if (message?.documentMessage) return "document";
    return "text";
  }

  private getMediaUrl(message: any): string | undefined {
    if (message?.imageMessage?.url) return message.imageMessage.url;
    if (message?.videoMessage?.url) return message.videoMessage.url;
    if (message?.audioMessage?.url) return message.audioMessage.url;
    if (message?.documentMessage?.url) return message.documentMessage.url;
    return undefined;
  }

  private getExtension(messageType: string, mimetype?: string): string {
    // Tentar extrair do mimetype primeiro
    if (mimetype) {
      const ext = mimetype.split("/")[1]?.split(";")[0];
      if (ext) {
        // Normalizar extensões comuns
        const normalizedExt = ext.replace("jpeg", "jpg").replace("mpeg", "mp3");
        return normalizedExt;
      }
    }

    const extensions = {
      image: "jpg",
      video: "mp4",
      audio: "ogg",
      document: "pdf",
    };
    return extensions[messageType] || "bin";
  }

  // Extrair mídia em Base64 da mensagem (quando webhook_base64 = true)
  private extractBase64Media(
    message: any,
  ): { data: string; mimetype: string } | null {
    // Verificar cada tipo de mídia
    const mediaTypes = [
      "imageMessage",
      "videoMessage",
      "audioMessage",
      "documentMessage",
    ];

    for (const type of mediaTypes) {
      if (message?.[type]) {
        const mediaMsg = message[type];

        console.log(`🔍 [Webhook] Verificando ${type}:`, {
          hasBase64: !!mediaMsg.base64,
          hasMedia: !!mediaMsg.media,
          hasDirectBase64: typeof mediaMsg === "string",
          mimetype: mediaMsg.mimetype,
          keys: Object.keys(mediaMsg),
        });

        // A Evolution API pode enviar base64 em diferentes formatos
        // Formato 1: { base64: "...", mimetype: "..." }
        if (mediaMsg.base64) {
          console.log(`✅ [Webhook] Base64 encontrado em ${type}.base64`);
          return {
            data: mediaMsg.base64,
            mimetype: mediaMsg.mimetype || this.getDefaultMimetype(type),
          };
        }

        // Formato 2: { mediaKey, ... } com base64 no campo data
        if (mediaMsg.media) {
          console.log(`✅ [Webhook] Base64 encontrado em ${type}.media`);
          return {
            data: mediaMsg.media,
            mimetype: mediaMsg.mimetype || this.getDefaultMimetype(type),
          };
        }

        // Formato 3: O próprio objeto pode ser base64 (string direta)
        if (typeof mediaMsg === "string" && mediaMsg.length > 100) {
          console.log(
            `✅ [Webhook] Base64 encontrado como string direta em ${type}`,
          );
          return {
            data: mediaMsg,
            mimetype: this.getDefaultMimetype(type),
          };
        }
      }
    }

    console.log("❌ [Webhook] Nenhum formato de base64 encontrado");
    return null;
  }

  private getDefaultMimetype(messageType: string): string {
    const mimetypes = {
      imageMessage: "image/jpeg",
      videoMessage: "video/mp4",
      audioMessage: "audio/ogg",
      documentMessage: "application/pdf",
    };
    return mimetypes[messageType] || "application/octet-stream";
  }

  // Salvar mídia Base64 em arquivo
  private async saveBase64Media(
    base64Data: string,
    fileName: string,
    mimetype: string,
  ): Promise<string | null> {
    try {
      // Remover prefixo data:xxx;base64, se existir
      const base64Clean = base64Data.replace(/^data:[^;]+;base64,/, "");

      const buffer = Buffer.from(base64Clean, "base64");
      const filePath = path.join(this.uploadsDir, fileName);

      await fs.mkdir(this.uploadsDir, { recursive: true });
      await fs.writeFile(filePath, buffer);

      console.log(
        `📁 Arquivo Base64 salvo: ${fileName} (${buffer.length} bytes)`,
      );
      return fileName;
    } catch (error) {
      console.error("❌ Erro ao salvar arquivo Base64:", error);
      return null;
    }
  }

  private async findLineByPhone(
    phoneNumber: string,
    include?: object,
  ): Promise<any | null> {
    const base = { orderBy: { id: "desc" as const } };

    const byEquals = await this.prisma.linesStock.findFirst({
      where: { phone: { equals: phoneNumber } },
      ...base,
      ...(include ? { include } : {}),
    });
    if (byEquals) return byEquals;

    const byEndsWith = await this.prisma.linesStock.findFirst({
      where: { phone: { endsWith: phoneNumber } },
      ...base,
      ...(include ? { include } : {}),
    });
    if (byEndsWith) return byEndsWith;

    return this.prisma.linesStock.findFirst({
      where: { phone: { contains: phoneNumber } },
      ...base,
      ...(include ? { include } : {}),
    });
  }
}
