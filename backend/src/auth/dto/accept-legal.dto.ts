import { Equals } from 'class-validator';
import { LEGAL_ACCEPTANCE_REQUIRED_MESSAGE } from '../../legal/legal-versions';

// Decorator compartilhado pelos três corpos que registram o aceite (cadastro, convite e reaceite):
// só o booleano `true` passa — ausente, false ou "true" (string) recebem a mesma mensagem.
export const IsLegalAcceptance = () => Equals(true, { message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE });

// POST /auth/me/legal-acceptance
export class AcceptLegalDto {
  @IsLegalAcceptance() acceptLegal!: boolean;
}
