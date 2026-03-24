import { IsNotEmpty, IsString, IsUrl } from "class-validator";

export class CreateEvolutionDto {
  @IsString()
  @IsNotEmpty()
  evolutionName: string;

  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  evolutionUrl: string;

  @IsString()
  @IsNotEmpty()
  evolutionKey: string;
}
