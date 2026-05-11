import { IsNotEmpty, IsString, MaxLength } from "class-validator";

/**
 * DTO para renomeação manual do título de um contato/grupo.
 * Usado pelo endpoint PATCH /contacts/rename/:phone (Shared Inbox).
 *
 * Regras:
 *  - O título digitado é gravado em `Contact.customTitle`.
 *  - `Contact.isNameManual` é setado para TRUE para impedir sobrescrita
 *    automática pelo webhook da Evolution API.
 *  - Todas as conversas do mesmo telefone passam a exibir esse título
 *    (campo `Conversation.contactName`) imediatamente.
 */
export class RenameContactDto {
  @IsString()
  @IsNotEmpty({ message: "O título não pode ser vazio" })
  @MaxLength(120, { message: "Título excede o tamanho máximo de 120 caracteres" })
  customTitle: string;
}
