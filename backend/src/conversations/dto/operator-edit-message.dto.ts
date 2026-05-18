import { IsOptional, IsString, MinLength } from "class-validator";

/**
 * Corpo da edição — aceita `text` (preferido, usado pelo frontend atual),
 * ou `message` / `newText` para compatibilidade com clientes legados.
 * O controller unifica num único string antes de chamar o serviço.
 */
export class OperatorEditMessageDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: "text deve ter pelo menos 1 caractere" })
  text?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: "message deve ter pelo menos 1 caractere" })
  message?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: "newText deve ter pelo menos 1 caractere" })
  newText?: string;
}
