import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";

@Injectable()
export class CpcService {
  private readonly logger = new Logger(CpcService.name);
  private readonly baseUrl =
    process.env.CPC_API_URL || "http://85.31.230.91:3001";
  private readonly authHeader =
    process.env.CPC_API_AUTH || "Basic VmVuZDp2VjMybmQjcw==";

  /**
   * Valida se o contrato existe e está ativo (não baixado) na base do parceiro.
   * Retorna true se válido, false se inválido ou erro.
   */
  async validateContract(
    cpf: string,
    contrato: string,
    segmento: string,
  ): Promise<boolean> {
    try {
      this.logger.log(
        `Validando contrato: cpf=${cpf}, contrato=${contrato}, segmento=${segmento}`,
      );
      const response = await axios.post(
        `${this.baseUrl}/cpc-duplo`,
        { cpf, contrato, segmento },
        {
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        },
      );
      const result = response.data?.sucesso === true;
      this.logger.log(
        `Resultado validate-contract: ${result} (${response.data?.mensagem || "sem mensagem"})`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(`Erro ao validar contrato: ${error.message}`);
      return false; // Negar por segurança
    }
  }

  /**
   * Checa se já existe um acionamento CPC na data atual.
   * Retorna true se NÃO existe (pode contatar), false se JÁ existe (bloqueado).
   */
  async checkAcionamento(
    telefone: string,
    contrato: string,
    segmento: string,
  ): Promise<boolean> {
    const telefoneSemDdi = telefone.startsWith("55")
      ? telefone.slice(2)
      : telefone;
    try {
      this.logger.log(
        `Checando acionamento: telefone=${telefoneSemDdi}, contrato=${contrato}, segmento=${segmento}`,
      );
      const response = await axios.post(
        `${this.baseUrl}/check-acionamento`,
        { telefone: telefoneSemDdi, contrato, segmento },
        {
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        },
      );
      const result = response.data?.sucesso === true;
      this.logger.log(
        `Resultado check-acionamento: ${result} (${response.data?.mensagem || "sem mensagem"})`,
      );
      return result;
    } catch (error: any) {
      this.logger.error(`Erro ao checar acionamento: ${error.message}`);
      return false; // Negar por segurança
    }
  }

  /**
   * Registra o acionamento digital (após cliente confirmar CPF).
   * Retorna true se registrado com sucesso, false se erro.
   */
  async registerAcionamento(
    telefone: string,
    contrato: string,
    segmento: string,
  ): Promise<boolean> {
    const telefoneSemDdi = telefone.startsWith("55")
      ? telefone.slice(2)
      : telefone;
    try {
      this.logger.log(
        `Registrando acionamento: telefone=${telefoneSemDdi}, contrato=${contrato}, segmento=${segmento}`,
      );
      const response = await axios.post(
        `${this.baseUrl}/register-acionamento`,
        { telefone: telefoneSemDdi, contrato, segmento },
        {
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        },
      );
      const result = response.data?.sucesso === true;
      this.logger.log(`Resultado register-acionamento: ${result}`);
      return result;
    } catch (error: any) {
      this.logger.error(`Erro ao registrar acionamento: ${error.message}`);
      return false;
    }
  }
}
