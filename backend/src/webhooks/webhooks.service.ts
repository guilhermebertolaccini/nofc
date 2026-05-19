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

        if (this.isPlaceholderMessage(message, data)) {
          console.log("[Webhook] Ignorando placeholderMessage");
          return { status: "ignored", reason: "placeholderMessage" };
        }

        // ─────────────────────────────────────────────────────────────────
        // SHARED INBOX — `fromMe: true` deve ser PROCESSADO, não descartado.
        //
        // Antes existia um early return aqui ("ignored: Message from self").
        // No modelo de número único, mensagens enviadas pelo Celular do
        // dono / WhatsApp Web também devem aparecer no histórico do chat
        // (com `sender: 'operator'` e `userName: 'Celular/WhatsApp Web'`),
        // para que todos os operadores vejam exatamente o que foi enviado
        // por fora do sistema. Removemos o descarte e seguimos o fluxo.
        // ─────────────────────────────────────────────────────────────────
        const fromMe = !!message.key.fromMe;

        // Verificar se é mensagem de grupo
        const isGroup = message.key.remoteJid?.includes("@g.us") || false;
        const groupId = isGroup ? message.key.remoteJid : null;

        // Para grupos, extrair informações do grupo e do participante
        let from: string;
        let groupName: string | null = null;
        let participantName: string | null = null;

        if (isGroup) {
          // Em grupos, o remoteJid SEMPRE é o ID do grupo (independente
          // de fromMe). O alvo da conversa é o grupo.
          from = groupId || "";

          // Para grupos, iniciar com nome padrão e buscar o nome real via Evolution API
          groupName = "Grupo sem nome";

          // O participante que enviou está em message.participant ou message.key.participant
          const participant = message.participant || message.key.participant;
          if (fromMe) {
            // Mensagem enviada do próprio aparelho/Web para um grupo:
            // marcamos o `participantName` como nulo (não é "um cliente
            // específico falando no grupo") — quem o operador atendeu vai
            // ler no balão `userName` do lado da bolha de operador.
            participantName = null;
          } else if (participant) {
            participantName =
              message.pushName ||
              participant
                .replace("@s.whatsapp.net", "")
                .replace("@c.us", "")
                .replace("@lid", "");
          }
          console.log(
            `👥 Mensagem de grupo detectada: ${groupName} (${groupId}), participante: ${participantName}, fromMe: ${fromMe}`,
          );
        } else {
          // remoteJid:
          //   - fromMe=false → JID do remetente (o cliente)
          //   - fromMe=true  → JID do destinatário (o cliente do outro lado)
          // Em ambos os casos é o ID do cliente — exatamente o que queremos
          // para `contactPhone`.
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

        // Reações WhatsApp (Evolution: message.reactionMessage) — tratadas
        // antes do pipeline de mídia/texto normal: atualizam a mensagem-alvo
        // no banco + emitem `message_reaction`, ou gravam linha órfã.
        const messageKindEarly = this.getMessageType(message.message);
        if (messageKindEarly === "reaction") {
          const instanceName = data.instance || data.instanceName;
          const phoneNumber = instanceName?.replace("line_", "");
          const line = await this.findLineByPhone(phoneNumber, {
            operators: { include: { user: true } },
          });
          if (!line) {
            return { status: "ignored", reason: "Line not found" };
          }
          const contactIdentifier = isGroup ? groupId || from : from;
          const contactQuick = await this.prisma.contact.findFirst({
            where: { phone: contactIdentifier },
          });
          const shortGroup =
            groupId != null
              ? `Grupo ${String(groupId).split("@")[0].replace(/\D/g, "").slice(-6)}`
              : "Grupo";
          const resolvedGroupName = isGroup
            ? contactQuick?.customTitle?.trim() ||
              contactQuick?.name ||
              shortGroup
            : null;
          const contactDisplayName = isGroup
            ? resolvedGroupName || shortGroup
            : contactQuick?.name || message.pushName || from;

          return this.processReactionWebhook({
            message,
            line,
            contactIdentifier,
            isGroup,
            groupName: resolvedGroupName,
            groupIdJid: groupId || undefined,
            contactDisplayName,
            fromMe,
            participantName,
          });
        }

        // Extrair texto da mensagem (templates HSM, listas, botões, wrappers Baileys)
        // Stickers nunca têm caption — usamos "Figurinha" como rótulo
        // (o frontend renderiza a imagem em vez do texto quando há mediaUrl).
        const messageText = this.extractDisplayMessageText(
          message.message,
          "Mensagem recebida",
        );

        console.log("💬 Texto:", messageText);

        const messageType = this.getMessageType(message.message);
        let mediaUrl = this.getMediaUrl(message.message);

        const documentSourceFileName =
          messageType === "document"
            ? this.getDocumentSourceFileName(message.message)
            : undefined;

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

        const contactIdentifierForProto = isGroup ? groupId || from : from;

        const protoHandled = await this.tryHandleProtocolMessageUpsert({
          message,
          line,
          contactIdentifier: contactIdentifierForProto,
        });
        if (protoHandled) return protoHandled;

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
              const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType, base64Media.mimetype, documentSourceFileName)}`;
              const localFileName = await this.saveBase64Media(
                base64Media.data,
                fileName,
                base64Media.mimetype,
              );

              if (localFileName) {
                mediaUrl = this.buildMediaUrl(localFileName);
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
                const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType, undefined, documentSourceFileName)}`;
                const localFileName =
                  await this.mediaService.downloadMediaFromEvolution(
                    mediaUrl,
                    fileName,
                  );

                if (localFileName) {
                  mediaUrl = this.buildMediaUrl(localFileName);
                  console.log("📥 Mídia URL salva localmente:", mediaUrl);
                } else {
                  // Download falhou — não persistir URL CDN encriptada
                  // (ela expira e o navegador não consegue descriptografar).
                  console.warn(
                    "⚠️ [Webhook] Download falhou; descartando mediaUrl CDN para evitar imagem quebrada no refresh.",
                  );
                  mediaUrl = undefined;
                }
              } catch (error) {
                console.error("❌ Erro ao baixar mídia:", error.message);
                mediaUrl = undefined;
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
            const fileName = `${Date.now()}-${from}-${messageType}.${this.getExtension(messageType, undefined, documentSourceFileName)}`;
            const localFileName =
              await this.mediaService.downloadMediaFromEvolution(
                mediaUrl,
                fileName,
              );

            if (localFileName) {
              mediaUrl = this.buildMediaUrl(localFileName);
              console.log("📥 Mídia salva localmente:", mediaUrl);
            } else {
              console.warn(
                "⚠️ [Webhook] Download falhou; descartando mediaUrl CDN.",
              );
              mediaUrl = undefined;
            }
          } catch (error) {
            console.error("❌ Erro ao baixar mídia:", error.message);
            mediaUrl = undefined;
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
          name.trim() !== "Desconhecido" &&
          !this.looksLikeGroupJidName(name);

        if (isGroup && groupId) {
          const isNewGroupContact = !contact;

          // (1) customTitle do banco — fonte de verdade no Shared Inbox
          if (contact?.customTitle && contact.customTitle.trim()) {
            groupName = contact.customTitle.trim();
            console.log(
              `📌 [Webhook] Reusando customTitle do contato (skip Evolution): ${groupName}`,
            );
          }
          // (2) name em cache no banco (desde que não seja JID cru)
          else if (
            contact &&
            hasDecentCachedName(contact.name) &&
            !this.looksLikeGroupJidName(contact.name)
          ) {
            groupName = contact!.name.trim();
            console.log(
              `📌 [Webhook] Reusando contact.name em cache (skip Evolution): ${groupName}`,
            );
          }
          // (3) Evolution API — primeira interação ou nome ainda é JID
          else if (
            isNewGroupContact ||
            this.looksLikeGroupJidName(contact?.name) ||
            !hasDecentCachedName(contact?.name)
          ) {
            try {
              const evolution = await this.prisma.evolution.findUnique({
                where: { evolutionName: line.evolutionName },
              });
              if (evolution) {
                const realGroupName = await this.resolveGroupSubject(
                  groupId,
                  evolution.evolutionUrl,
                  evolution.evolutionKey,
                  instanceName,
                );
                if (realGroupName && realGroupName.trim()) {
                  groupName = realGroupName.trim();
                  console.log(
                    `✅ [Webhook] Nome do grupo via Evolution API (subject): ${groupName}`,
                  );
                }
              }
            } catch (err: any) {
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
          const previousName = contact.name;
          contact = await this.prisma.contact.update({
            where: { id: contact.id },
            data: { name: groupName! },
          });
          console.log(
            `✅ [Webhook] Nome do grupo atualizado automaticamente: ${contact.name} (${contactIdentifier})`,
          );
          if (
            this.looksLikeGroupJidName(previousName) ||
            previousName !== groupName
          ) {
            this.websocketGateway.emitConversationDisplayNameUpdated({
              contactPhone: contactIdentifier,
              contactName: contact.name,
              customTitle: contact.customTitle,
            });
          }
        } else if (isGroup && (contact.isNameManual || contact.customTitle)) {
          console.log(
            `ℹ️ [Webhook] Grupo ${contactIdentifier} tem nome travado (customTitle/isNameManual), preservando: ${contact.customTitle || contact.name}`,
          );
        }

        // Registrar resposta do cliente (reseta repescagem) - apenas para
        // contatos individuais INBOUND (mensagens vindas do cliente).
        // `fromMe=true` é um envio nosso (Celular/Web), não conta como
        // resposta do cliente — não devemos resetar repescagem nem rodar
        // CPC/blocklist.
        if (!isGroup && !fromMe) {
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

        // Verificar frases de bloqueio automático - apenas para contatos
        // individuais INBOUND. `fromMe=true` é nosso envio externo: não
        // faz sentido bloquear o próprio cliente porque NÓS escrevemos
        // uma palavra-chave.
        let blockedByPhrase = false;
        if (!isGroup && !fromMe) {
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
        // No modo compartilhado, atribuir para todos os usuários da linha.
        //
        // IMPORTANTE: quando `fromMe=true` (mensagem externa enviada pelo
        // Celular/WhatsApp Web), NÃO atribuímos a um operador — não é uma
        // mensagem entrante aguardando atendimento. A conversa será salva
        // com `userId=null` e `userName='Celular/WhatsApp Web'`.
        let finalOperatorId: number | null = null;

        if (fromMe) {
          // Pular toda a alocação de operador para envios externos.
          console.log(
            `🪪 [Webhook] Mensagem fromMe (envio externo) — não atribuindo operador interno.`,
          );
        } else if (sharedLineMode && isGroup) {
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

        // Se não encontrou operador, tentar encontrar qualquer operador/admin
        // online da linha. (Pular para `fromMe`: o envio externo não precisa
        // de operador atribuído.)
        if (!fromMe && !finalOperatorId && line.operators && line.operators.length > 0) {
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

        // Se ainda não encontrou operador online, adicionar à fila de mensagens.
        //
        // IMPORTANTE: pular esta etapa quando `fromMe=true`. Mensagens
        // enviadas pelo Celular/WhatsApp Web não estão "aguardando
        // atendimento" — elas SÃO o atendimento que aconteceu por fora
        // do sistema. Em vez de enfileirar, prosseguimos para criar a
        // Conversation com `userId=null` para que o histórico fique
        // completo no painel.
        if (!finalOperatorId && !fromMe) {
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

        // ─────────────────────────────────────────────────────────────────
        // Decisão de autoria.
        // - Mensagem inbound (cliente → nós): sender='contact', userName
        //   exibe o operador atribuído (para a UI do chat).
        // - Mensagem `fromMe=true` (envio externo via Celular/WhatsApp Web):
        //   sender='operator', userName='Celular/WhatsApp Web'.
        //   `userId` permanece null — não há um operador interno conhecido
        //   por trás desse envio externo.
        // ─────────────────────────────────────────────────────────────────
        const senderForConversation: "contact" | "operator" = fromMe
          ? "operator"
          : "contact";
        const operatorNameFromLine = finalOperatorId
          ? line.operators.find((lo) => lo.userId === finalOperatorId)?.user
              .name || null
          : null;
        const userNameForConversation = fromMe
          ? "Celular/WhatsApp Web"
          : operatorNameFromLine;
        const userIdForConversation = fromMe ? null : finalOperatorId;

        // Criar conversa
        const conversation = await this.conversationsService.create({
          contactName: isGroup ? groupName || contact.name : contact.name, // Para grupos, usar nome do grupo
          contactPhone: from,
          segment: line.segment,
          userName: userNameForConversation,
          userLine: line.id,
          userId: userIdForConversation,
          message: messageText,
          sender: senderForConversation,
          messageType,
          mediaUrl,
          isGroup,
          groupId: groupId || undefined,
          groupName: isGroup ? groupName : undefined,
          participantName: isGroup ? participantName : undefined, // Nome de quem enviou no grupo
          datetime: evolutionDatetime,
          waMessageId: message.key?.id ?? undefined,
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

      if (
        data.event === "contacts.update" ||
        data.event === "CONTACTS_UPDATE"
      ) {
        return this.handleContactsUpdate(data);
      }

      return { status: "processed" };
    } catch (error) {
      console.error("Erro ao processar webhook:", error);
      return { status: "error", error: error.message };
    }
  }

  /**
   * Eventos de sincronização de criptografia do WhatsApp — não são mensagens visíveis.
   */
  private isPlaceholderMessage(message: any, data?: any): boolean {
    const topType = message?.messageType ?? data?.messageType;
    if (topType === "placeholderMessage") return true;
    if (message?.placeholderMessage) return true;
    const inner = message?.message;
    if (inner?.placeholderMessage) return true;
    return this.getMessageType(inner) === "placeholderMessage";
  }

  /**
   * Atualiza fotos de perfil quando a Evolution dispara contacts.update.
   */
  private async handleContactsUpdate(data: any) {
    const rawItems = Array.isArray(data?.data)
      ? data.data
      : data?.data
        ? [data.data]
        : [];

    if (rawItems.length === 0) {
      return { status: "contacts_update_empty" };
    }

    let updated = 0;

    for (const item of rawItems) {
      const remoteJid =
        (typeof item?.remoteJid === "string" && item.remoteJid.trim()) ||
        (typeof item?.id === "string" && item.id.trim()) ||
        (typeof item?.jid === "string" && item.jid.trim()) ||
        null;

      if (!remoteJid) continue;

      const profilePicUrl =
        (typeof item?.profilePicUrl === "string" && item.profilePicUrl.trim()) ||
        (typeof item?.profilePictureUrl === "string" &&
          item.profilePictureUrl.trim()) ||
        (typeof item?.imgUrl === "string" && item.imgUrl.trim()) ||
        (typeof item?.picture === "string" && item.picture.trim()) ||
        null;

      if (!profilePicUrl) continue;

      const isGroup = remoteJid.includes("@g.us");
      const contactPhone = isGroup
        ? remoteJid
        : remoteJid
            .replace("@s.whatsapp.net", "")
            .replace("@c.us", "")
            .replace("@lid", "");

      const result = await this.prisma.contact.updateMany({
        where: { phone: contactPhone },
        data: { profilePicUrl },
      });

      if (result.count === 0) {
        try {
          await this.prisma.contact.create({
            data: {
              phone: contactPhone,
              name: contactPhone,
              profilePicUrl,
            },
          });
        } catch {
          // race: contato criado por outro fluxo
        }
      }

      const contact = await this.prisma.contact.findFirst({
        where: { phone: contactPhone },
      });

      this.websocketGateway.emitConversationDisplayNameUpdated({
        contactPhone,
        contactName: contact?.name || contactPhone,
        customTitle: contact?.customTitle,
        isPinned: contact?.isPinned,
        profilePicUrl,
      });

      updated += 1;
    }

    return { status: "contacts_update_processed", updated };
  }

  /**
   * Nome salvo ainda é o JID cru do WhatsApp (ex.: 120363…@g.us).
   */
  private looksLikeGroupJidName(name?: string | null): boolean {
    if (!name || typeof name !== 'string') return false;
    const t = name.trim();
    return t.includes('@g.us') || /^[\d-]+@g\.us$/i.test(t);
  }

  /**
   * Resolve o subject do grupo: findGroupInfos/MetaData (preciso) → fetchAllGroups (fallback).
   */
  private async resolveGroupSubject(
    groupId: string,
    evolutionUrl: string,
    evolutionKey: string,
    instanceName: string,
  ): Promise<string | null> {
    try {
      const meta = await this.evolutionService.getGroupMetadata(
        evolutionUrl,
        evolutionKey,
        instanceName,
        groupId,
      );
      if (meta?.subject?.trim()) {
        return meta.subject.trim();
      }
    } catch (err: any) {
      console.warn(
        `⚠️ [Webhook] getGroupMetadata falhou para ${groupId}: ${err?.message}`,
      );
    }

    return this.fetchGroupNameFromAllGroups(
      groupId,
      evolutionUrl,
      evolutionKey,
      instanceName,
    );
  }

  /**
   * Fallback: lista todos os grupos e faz match por id (endpoint instável).
   */
  private async fetchGroupNameFromAllGroups(
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
        `⚠️ [Webhook] fetchGroupNameFromAllGroups falhou para ${groupId}: ${reason}. ` +
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
            name.trim() !== "Desconhecido" &&
            !this.looksLikeGroupJidName(name);

          let contactName: string =
            chat.name || chat.pushName || contactPhone;

          if (isGroup) {
            let resolvedGroupName: string | null = null;
            const isNewGroupContact = !contact;

            // (1) customTitle do banco — fonte de verdade no Shared Inbox
            if (contact?.customTitle && contact.customTitle.trim()) {
              resolvedGroupName = contact.customTitle.trim();
              console.log(
                `📌 [Webhook/History] Reusando customTitle (skip Evolution): ${resolvedGroupName}`,
              );
            }
            // (2) name em cache no banco
            else if (
              contact &&
              hasDecentCachedName(contact.name) &&
              !this.looksLikeGroupJidName(contact.name)
            ) {
              resolvedGroupName = contact!.name.trim();
              console.log(
                `📌 [Webhook/History] Reusando contact.name em cache (skip Evolution): ${resolvedGroupName}`,
              );
            }
            // (3) Evolution API — subject via findGroupInfos / fallback
            else if (
              isNewGroupContact ||
              this.looksLikeGroupJidName(contact?.name) ||
              !hasDecentCachedName(contact?.name)
            ) {
              try {
                const apiName = await this.resolveGroupSubject(
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
          //
          // SHARED INBOX — espelhamento do MESSAGES_UPSERT:
          // Removido o early return `if (msg.key?.fromMe) continue;` que
          // existia aqui. Agora mensagens enviadas pelo Celular/WhatsApp
          // Web também são importadas no histórico inicial, com:
          //   - sender   = 'operator'
          //   - userName = 'Celular/WhatsApp Web'
          //   - userId   = null  (não há operador interno responsável)
          // Isso garante que ao escanear o QR Code o painel mostre o
          // histórico real, incluindo respostas dadas por fora do sistema.
          for (const msg of messages) {
            try {
              const isFromMe = !!msg.key?.fromMe;

              const messageText =
                (msg.message?.reactionMessage?.text
                  ? `Reagiu com: ${msg.message.reactionMessage.text}`
                  : null) ||
                this.extractDisplayMessageText(
                  msg.message,
                  "Mensagem importada",
                );

              const messageType = this.getMessageType(msg.message);
              const sender = isFromMe ? "operator" : "contact";
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

              // Autoria coerente com MESSAGES_UPSERT:
              //   - fromMe=true  → envio externo (Celular/WhatsApp Web), userId=null
              //   - fromMe=false → mensagem inbound do cliente, vinculada ao operador online
              const userNameForConversation = isFromMe
                ? "Celular/WhatsApp Web"
                : operatorName;
              const userIdForConversation = isFromMe ? null : operatorId;

              // Criar conversa vinculada ao operador online (se houver)
              await this.conversationsService.create({
                contactName: contactName,
                contactPhone: isGroup ? remoteJid : contactPhone,
                segment: line.segment,
                userName: userNameForConversation,
                userLine: lineId,
                userId: userIdForConversation,
                message: messageText,
                sender: sender as any,
                messageType,
                isGroup,
                groupId: isGroup ? remoteJid : undefined,
                groupName: isGroup ? contactName : undefined,
                datetime,
                waMessageId: msg.key?.id ?? undefined,
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

  /**
   * REVOKE / MESSAGE_EDIT (protocolMessage) vindos do WhatsApp. Atualiza o
   * registro local e emite `message_updated`; não insere nova linha na conversa.
   */
  private async tryHandleProtocolMessageUpsert(params: {
    message: any;
    line: any;
    contactIdentifier: string;
  }): Promise<{ status: string; reason?: string } | null> {
    const rawInner = params.message?.message;
    const core = this.unwrapNestedMessageContent(rawInner);
    const pm: any =
      core?.protocolMessage ||
      rawInner?.editedMessage?.message?.protocolMessage;

    if (!pm || typeof pm !== "object") return null;

    const t = pm.type;
    const tStr = typeof t === "string" ? t.toUpperCase() : "";
    const isRevoke = t === 0 || t === "0" || tStr === "REVOKE";
    const hasEditedPayload = !!pm.editedMessage;
    const isEdit =
      t === 14 ||
      t === "14" ||
      tStr === "MESSAGE_EDIT" ||
      hasEditedPayload;

    if (!isRevoke && !isEdit) {
      return {
        status: "ignored",
        reason: `protocolMessage type ${String(t)}`,
      };
    }

    const rawTargetId = pm.key?.id;
    if (rawTargetId === undefined || rawTargetId === null || rawTargetId === "") {
      return { status: "ignored", reason: "protocolMessage sem key.id" };
    }
    const targetWaId = String(rawTargetId);

    const findTarget = () =>
      this.prisma.conversation.findFirst({
        where: {
          contactPhone: params.contactIdentifier,
          waMessageId: targetWaId,
        },
        orderBy: { id: "desc" },
      });

    if (isRevoke) {
      const target = await findTarget();
      if (!target) {
        return { status: "ignored", reason: "revoke target not found" };
      }
      const updated = await this.prisma.conversation.update({
        where: { id: target.id },
        data: { isDeleted: true },
      });
      await this.websocketGateway.emitMessageUpdated(updated);
      console.log(
        `🗑️ [Webhook] REVOKE → msg id=${target.id} wa=${targetWaId}`,
      );
      return { status: "success", reason: "revoke_applied" };
    }

    const newText = this.extractProtocolEditedBody(pm);
    if (!newText.trim()) {
      return { status: "ignored", reason: "edit sem texto" };
    }

    const target = await findTarget();
    if (!target) {
      return { status: "ignored", reason: "edit target not found" };
    }
    const updated = await this.prisma.conversation.update({
      where: { id: target.id },
      data: { message: newText.trim(), isEdited: true },
    });
    await this.websocketGateway.emitMessageUpdated(updated);
    console.log(
      `✏️ [Webhook] MESSAGE_EDIT → msg id=${target.id} wa=${targetWaId}`,
    );
    return { status: "success", reason: "edit_applied" };
  }

  private extractProtocolEditedBody(pm: any): string {
    const em = pm?.editedMessage;
    if (!em) return "";
    const nested = em.message ?? em;
    const fromNested = this.pickStructuredText(nested);
    const fromEm = this.pickStructuredText(em);
    return (fromNested || fromEm || "").trim();
  }

  /**
   * Processa `reactionMessage` da Evolution/Baileys.
   * - Se existir mensagem interna com `waMessageId` = key.id do alvo →
   *   acumula emoji em `reactionsJson` e emite `message_reaction`.
   * - Caso contrário → grava linha `messageType=reaction` ("Reagiu com: …")
   *   e emite `new_message` (fallback no frontend).
   */
  private async processReactionWebhook(params: {
    message: any;
    line: any;
    contactIdentifier: string;
    isGroup: boolean;
    groupName: string | null;
    groupIdJid?: string;
    contactDisplayName: string;
    fromMe: boolean;
    participantName: string | null;
  }) {
    const {
      message,
      line,
      contactIdentifier,
      isGroup,
      groupName,
      groupIdJid,
      contactDisplayName,
      fromMe,
      participantName,
    } = params;

    const reactionMsg = message.message?.reactionMessage;
    if (!reactionMsg) {
      return { status: "ignored", reason: "No reactionMessage" };
    }

    const emoji =
      (typeof reactionMsg.text === "string" && reactionMsg.text) ||
      reactionMsg.reaction ||
      reactionMsg.emoji ||
      "❓";
    const targetWaId = reactionMsg.key?.id;
    if (!targetWaId) {
      console.warn("⚠️ [Webhook] Reação sem key.id do alvo — ignorando");
      return { status: "ignored", reason: "No reaction target id" };
    }

    const target = await this.prisma.conversation.findFirst({
      where: {
        contactPhone: contactIdentifier,
        waMessageId: targetWaId,
      },
      orderBy: { id: "desc" },
    });

    if (target) {
      let prev: string[] = [];
      if (target.reactionsJson) {
        try {
          prev = JSON.parse(target.reactionsJson) as string[];
        } catch {
          prev = [];
        }
      }
      const next = [...prev, emoji].slice(-20);
      await this.prisma.conversation.update({
        where: { id: target.id },
        data: { reactionsJson: JSON.stringify(next) },
      });

      await this.websocketGateway.emitMessageReaction({
        contactPhone: contactIdentifier,
        targetMessageId: target.id,
        emojis: next,
        lastEmoji: emoji,
        userLine: line.id,
        segment: line.segment ?? null,
        userId: target.userId,
      });

      console.log(
        `❤️ [Webhook] Reação ${emoji} aplicada à mensagem id=${target.id} (wa=${targetWaId})`,
      );
      return { status: "success", kind: "reaction_applied" };
    }

    const evolutionDatetime =
      (message.messageTimestamp ?? message.key?.messageTimestamp)
        ? new Date(
            Number(
              message.messageTimestamp ?? message.key?.messageTimestamp,
            ) * 1000,
          )
        : undefined;

    const sender: "contact" | "operator" = fromMe ? "operator" : "contact";
    const userNameForConversation = fromMe ? "Celular/WhatsApp Web" : null;

    const conversation = await this.conversationsService.create({
      contactName: isGroup ? groupName || contactDisplayName : contactDisplayName,
      contactPhone: contactIdentifier,
      segment: line.segment ?? undefined,
      userName: userNameForConversation ?? undefined,
      userLine: line.id,
      userId: null,
      message: `Reagiu com: ${emoji}`,
      sender,
      messageType: "reaction",
      isGroup,
      groupId: isGroup ? groupIdJid || contactIdentifier : undefined,
      groupName: isGroup ? groupName || undefined : undefined,
      participantName: isGroup ? participantName ?? undefined : undefined,
      waMessageId: message.key?.id ?? undefined,
      datetime: evolutionDatetime,
    });

    await this.websocketGateway.emitNewMessage({
      ...conversation,
      blockedByPhrase: false,
    });

    console.log(
      `❤️ [Webhook] Reação órfã (${emoji}) persistida como conversa id=${conversation.id}`,
    );
    return { status: "success", kind: "reaction_orphan", conversation };
  }

  /**
   * Desembrulha mensagens efêmeras / view-once / caption-document (Baileys).
   * O payload útil costuma estar em `.message` dentro desses nós.
   */
  private unwrapNestedMessageContent(content: any): any {
    if (!content || typeof content !== "object") return content;
    let current = content;
    for (let depth = 0; depth < 5; depth++) {
      const next =
        current?.viewOnceMessage?.message ||
        current?.viewOnceMessageV2?.message ||
        current?.ephemeralMessage?.message ||
        current?.documentWithCaptionMessage?.message;
      if (!next || next === current) break;
      current = next;
    }
    return current;
  }

  /**
   * Texto “legível” para o painel: conversa simples, caption, templates comerciais,
   * HSM, listas, respostas interativas, etc.
   */
  private pickStructuredText(m: any): string | undefined {
    if (!m) return undefined;
    const raw =
      m?.conversation ||
      m?.extendedTextMessage?.text ||
      m?.imageMessage?.caption ||
      m?.videoMessage?.caption ||
      m?.documentMessage?.caption ||
      (typeof m?.documentMessage?.fileName === "string"
        ? m.documentMessage.fileName.trim()
        : "") ||
      (typeof m?.documentMessage?.title === "string"
        ? m.documentMessage.title.trim()
        : "") ||
      m?.templateMessage?.hydratedTemplate?.hydratedContentText ||
      m?.templateMessage?.hydratedFourRowTemplate?.hydratedContentText ||
      m?.templateMessage?.hydratedTemplate?.hydratedTitleText ||
      m?.highlyStructuredMessage?.hydratedHsm?.hydratedContentText ||
      m?.buttonsMessage?.contentText ||
      m?.listMessage?.description ||
      m?.listMessage?.title ||
      m?.buttonsResponseMessage?.selectedDisplayText ||
      m?.listResponseMessage?.title ||
      m?.interactiveMessage?.body?.text ||
      m?.interactiveMessage?.header?.title;

    if (raw === undefined || raw === null) return undefined;
    const s = String(raw).trim();
    return s.length > 0 ? s : undefined;
  }

  /**
   * Texto exibido no histórico + fallbacks para mídia sem legenda.
   */
  private extractDisplayMessageText(
    content: any,
    emptyFallback: string,
  ): string {
    const core = this.unwrapNestedMessageContent(content);
    const structured =
      this.pickStructuredText(content) || this.pickStructuredText(core);

    const hasSticker = !!(content?.stickerMessage || core?.stickerMessage);
    const hasImage = !!(content?.imageMessage || core?.imageMessage);
    const hasVideo = !!(content?.videoMessage || core?.videoMessage);
    const hasAudio = !!(content?.audioMessage || core?.audioMessage);
    const hasDocument = !!(
      content?.documentMessage || core?.documentMessage
    );

    return (
      structured ||
      (hasImage ? "Imagem recebida" : undefined) ||
      (hasSticker ? "Figurinha" : undefined) ||
      (hasVideo ? "Vídeo recebido" : undefined) ||
      (hasAudio ? "Áudio recebido" : undefined) ||
      (hasDocument ? "Documento recebido" : undefined) ||
      emptyFallback
    );
  }

  private getMessageType(message: any): string {
    const m = this.unwrapNestedMessageContent(message);
    if (m?.placeholderMessage) return "placeholderMessage";
    if (m?.reactionMessage) return "reaction";
    if (
      m?.templateMessage ||
      m?.highlyStructuredMessage ||
      m?.buttonsMessage ||
      m?.listMessage ||
      m?.buttonsResponseMessage ||
      m?.listResponseMessage ||
      m?.interactiveMessage
    ) {
      return "text";
    }
    if (m?.imageMessage) return "image";
    // Stickers (figurinhas) são tratados como uma categoria própria —
    // pipeline de download é o mesmo de uma imagem, mas o frontend renderiza
    // num tamanho menor para preservar a estética de figurinha.
    if (m?.stickerMessage) return "sticker";
    if (m?.videoMessage) return "video";
    if (m?.audioMessage) return "audio";
    if (m?.documentMessage) return "document";
    return "text";
  }

  private getMediaUrl(message: any): string | undefined {
    const m = this.unwrapNestedMessageContent(message);
    if (m?.imageMessage?.url) return m.imageMessage.url;
    if (m?.stickerMessage?.url) return m.stickerMessage.url;
    if (m?.videoMessage?.url) return m.videoMessage.url;
    if (m?.audioMessage?.url) return m.audioMessage.url;
    if (m?.documentMessage?.url) return m.documentMessage.url;
    return undefined;
  }

  /**
   * Constrói a URL pública de uma mídia salva localmente.
   *
   * Estratégia:
   *   - Se `process.env.APP_URL` estiver definida, retorna URL ABSOLUTA
   *     (`<APP_URL>/media/<file>`). Indicada em produção/deploys onde o
   *     frontend pode ser servido em domínio diferente do backend.
   *   - Caso contrário, retorna o caminho RELATIVO padronizado
   *     (`/media/<file>`). O frontend então concatena com `VITE_API_URL`
   *     ao renderizar (helper `resolveMediaUrl` em Atendimento.tsx).
   *
   * Em qualquer dos modos, o caminho é PADRONIZADO e nunca contém
   * URLs CDN da WhatsApp (que requerem descriptografia e expiram).
   */
  private buildMediaUrl(fileName: string): string {
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    return appUrl ? `${appUrl}/media/${fileName}` : `/media/${fileName}`;
  }

  /**
   * Nome de ficheiro / título enviado pela Evolution em documentos (para extensão e rótulo).
   */
  private getDocumentSourceFileName(webhookMessageInner: any): string | undefined {
    const core = this.unwrapNestedMessageContent(webhookMessageInner);
    const pick = (m: any): string | undefined => {
      const d = m?.documentMessage;
      if (!d) return undefined;
      const fn = typeof d.fileName === "string" ? d.fileName.trim() : "";
      const t = typeof d.title === "string" ? d.title.trim() : "";
      const name = fn || t;
      return name.length > 0 ? name : undefined;
    };
    return pick(webhookMessageInner) ?? pick(core);
  }

  /** Remove parâmetros após `;` (ex.: `audio/ogg; codecs=opus` → `audio/ogg`). */
  private sanitizeMimeType(mimetype?: string | null): string {
    if (mimetype == null || typeof mimetype !== "string") return "";
    return mimetype.split(";")[0]?.trim() ?? "";
  }

  /** Extrai extensão normalizada a partir do nome original (ex: `Relatório.xlsx` → `xlsx`). */
  private extensionFromDocumentFileName(
    originalFileName: string,
  ): string | undefined {
    if (!originalFileName || typeof originalFileName !== "string") {
      return undefined;
    }
    const base = path.basename(originalFileName.trim());
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot >= base.length - 1) return undefined;
    let ext = base.slice(dot + 1).toLowerCase();
    ext = ext.replace(/[^a-z0-9]/g, "");
    if (!ext || ext.length > 12) return undefined;
    return ext;
  }

  private getExtension(
    messageType: string,
    mimetype?: string,
    documentOriginalFileName?: string,
  ): string {
    if (messageType === "document" && documentOriginalFileName) {
      const fromName = this.extensionFromDocumentFileName(
        documentOriginalFileName,
      );
      if (fromName) return fromName;
    }

    if (mimetype) {
      const cleanMime = this.sanitizeMimeType(mimetype);
      if (cleanMime) {
        const normalized = cleanMime.toLowerCase();
        const mimeToExt: Record<string, string> = {
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            "xlsx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            "docx",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            "pptx",
          "application/vnd.ms-excel": "xls",
          "application/msword": "doc",
          "application/vnd.ms-powerpoint": "ppt",
          "application/pdf": "pdf",
          "application/vnd.oasis.opendocument.text": "odt",
          "application/vnd.oasis.opendocument.spreadsheet": "ods",
          "application/vnd.oasis.opendocument.presentation": "odp",
          "audio/ogg": "ogg",
          "audio/opus": "opus",
          "audio/mpeg": "mp3",
          "audio/mp4": "m4a",
          "audio/webm": "webm",
          "audio/aac": "aac",
          "audio/x-wav": "wav",
          "audio/wav": "wav",
        };
        if (mimeToExt[normalized]) {
          return mimeToExt[normalized];
        }

        const sub = cleanMime.split("/")[1];
        if (sub) {
          return sub.replace("jpeg", "jpg").replace("mpeg", "mp3");
        }
      }
    }

    const extensions: Record<string, string> = {
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
    // `stickerMessage` é incluído aqui para reaproveitar todo o pipeline
    // de extração/persistência das imagens (mesmo cabeçalho base64 vindo
    // da Evolution API; o mimetype default é image/webp).
    const mediaTypes = [
      "imageMessage",
      "stickerMessage",
      "videoMessage",
      "audioMessage",
      "documentMessage",
    ];

    const core = this.unwrapNestedMessageContent(message);
    const layers =
      core != null && core !== message ? [message, core] : [message];

    for (const layer of layers) {
      for (const type of mediaTypes) {
        if (layer?.[type]) {
          const mediaMsg = layer[type];

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
              mimetype:
                this.sanitizeMimeType(mediaMsg.mimetype) ||
                this.getDefaultMimetype(type),
            };
          }

          // Formato 2: { mediaKey, ... } com base64 no campo data
          if (mediaMsg.media) {
            console.log(`✅ [Webhook] Base64 encontrado em ${type}.media`);
            return {
              data: mediaMsg.media,
              mimetype:
                this.sanitizeMimeType(mediaMsg.mimetype) ||
                this.getDefaultMimetype(type),
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
    }

    console.log("❌ [Webhook] Nenhum formato de base64 encontrado");
    return null;
  }

  private getDefaultMimetype(messageType: string): string {
    const mimetypes = {
      imageMessage: "image/jpeg",
      stickerMessage: "image/webp", // Figurinhas do WhatsApp são WebP animado/estático
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
