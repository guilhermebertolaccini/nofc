import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class ForwardMessageDto {
  @IsNumber()
  originalMessageId: number;

  @IsString()
  @IsNotEmpty()
  destinationPhone: string;
}
