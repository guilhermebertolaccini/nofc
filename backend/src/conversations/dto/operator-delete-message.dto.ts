import { IsIn, IsNotEmpty } from "class-validator";

export class OperatorDeleteMessageDto {
  @IsNotEmpty()
  @IsIn(["me", "everyone"])
  scope: "me" | "everyone";
}
