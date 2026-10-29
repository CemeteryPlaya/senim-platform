/**
 * Провайдер эскроу-счёта банка-партнёра.
 * Демо: деньги «двигаются» только в нашем журнале проводок.
 * В продакшене каждый метод — вызов API банка + webhook с подтверждением.
 */
export interface EscrowProvider {
  openAccount(input: { dealNumber: number; amount: number }): Promise<{ bank: string; iban: string }>;
  deposit(input: { iban: string; amount: number }): Promise<{ ok: true }>;
  release(input: { iban: string; amount: number; commission: number }): Promise<{ ok: true }>;
  refund(input: { iban: string; amount: number }): Promise<{ ok: true }>;
}

export const mockEscrowProvider: EscrowProvider = {
  async openAccount({ dealNumber }) {
    const digits = String(dealNumber).padStart(6, "0");
    return { bank: "Банк-партнёр (демо)", iban: `KZ86 125K ZT50 04${digits.slice(0, 2)} ${digits.slice(2)}0000` };
  },
  async deposit() {
    return { ok: true };
  },
  async release() {
    return { ok: true };
  },
  async refund() {
    return { ok: true };
  },
};
