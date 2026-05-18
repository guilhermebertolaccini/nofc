import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class OperatorEditMessageDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  text: string;
}
