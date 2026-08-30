import { describe, expect, it } from "vitest";
import {
  askDate,
  askName,
  askService,
  askStaff,
  confirmed,
  didNotUnderstand,
  hintFor,
  joinNatural,
  listing,
  mainMenu,
  offerSlots,
  relativeDay,
  review,
  slotUnavailable,
  staffNotFound,
} from "@/features/whatsapp/presentation/text-mode-copy";

const items = (names: string[]) => names.map((label, index) => ({ key: String(index + 1), label }));
const slots = (times: string[], staffName = "Rafael") =>
  times.map((time, index) => ({ key: String(index + 1), label: `${time} · ${staffName}`, time, staffName }));

describe("copy do modo texto", () => {
  it("junta alternativas como uma pessoa escreveria", () => {
    expect(joinNatural(["corte"])).toBe("corte");
    expect(joinNatural(["corte", "barba"])).toBe("corte e barba");
    expect(joinNatural(["corte", "barba", "corte e barba"], "ou")).toBe("corte, barba ou corte e barba");
  });

  it("fala de datas em termos relativos", () => {
    expect(relativeDay("2026-08-31", "2026-08-31")).toBe("hoje");
    expect(relativeDay("2026-09-01", "2026-08-31")).toBe("amanhã");
    expect(relativeDay("2026-09-04", "2026-08-31")).toBe("na sexta (4/9)");
    expect(relativeDay("2026-09-15", "2026-08-31")).toBe("no dia 15/9");
  });

  it("não numera abaixo do limite e numera só acima de doze", () => {
    const six = listing({ items: items(["A", "B", "C", "D", "E", "F"]), lead: "Tem", question: "Qual?" });
    expect(six).toBe("Tem A, B, C, D, E e F. Qual?");
    const eight = listing({ items: items(["A", "B", "C", "D", "E", "F", "G", "H"]), lead: "Tem", question: "Qual?" });
    expect(eight).toContain("• A");
    expect(eight).not.toMatch(/^\d+ — /m);
    const thirteen = listing({ items: items("ABCDEFGHIJKLM".split("")), lead: "Tem", question: "Qual?" });
    expect(thirteen).toContain("13 — M");
  });

  it("monta a conversa do agendamento", () => {
    expect(askService({ services: items(["Corte", "Barba", "Corte e barba"]) }))
      .toBe("A gente faz corte, barba e corte e barba. Qual você quer?");
    expect(askStaff({ service: "Corte e barba", staff: items(["Rafael", "Diego"]), understood: "corte e barba hoje" }))
      .toBe("Beleza, corte e barba hoje. Prefere algum profissional pra corte e barba? Tem Rafael e Diego. Ou tanto faz?");
    expect(staffNotFound({ name: "Raul", service: "Corte e barba", staff: items(["Rafael", "Diego"]), understood: "corte e barba hoje" }))
      .toBe("Beleza, corte e barba hoje. Só não achei ninguém chamado Raul por aqui. Corte e barba quem faz é Rafael e Diego. Prefere algum deles ou tanto faz?");
    expect(askDate({ understood: "corte com Rafael" }))
      .toBe('Beleza, corte com Rafael. Que dia fica bom pra você? Pode ser hoje, amanhã, ou me diz o dia — tipo "sexta" ou "dia 15".');
    expect(offerSlots({ understood: "corte e barba hoje com Rafael", dayLabel: "hoje", slots: slots(["14:00", "15:30", "16:00"]) }))
      .toBe("Beleza! Você quer corte e barba hoje com Rafael, certo? Olha, hoje a gente ainda tem 14:00, 15:30 e 16:00. Qual prefere?");
    expect(offerSlots({ dayLabel: "na sexta (4/9)", slots: [...slots(["14:00", "15:30"]), ...slots(["16:00"], "Diego")] }))
      .toBe("Olha, na sexta (4/9) a gente ainda tem\nRafael: 14:00 e 15:30\nDiego: 16:00\nQual prefere?");
    expect(slotUnavailable({ time: "14:00", dayLabel: "hoje", slots: slots(["13:30", "15:00"]) }))
      .toBe("Às 14:00 hoje já foi. O mais perto que tenho é 13:30 ou 15:00 — serve algum?");
    expect(askName({ understood: "hoje às 14:00 com Rafael" }))
      .toBe("Fechado, hoje às 14:00 com Rafael. Só me diz seu nome completo pra eu deixar reservado.");
    expect(review({ service: "Corte e barba", longDay: "sexta-feira, 4 de setembro", time: "14:00", staffName: "Rafael", customerName: "Ana Silva" }))
      .toBe("Então fica assim: corte e barba, sexta-feira, 4 de setembro às 14:00 com Rafael, no nome de Ana Silva. Posso confirmar?");
    expect(confirmed({ service: "Corte e barba", longDay: "sexta-feira, 4 de setembro", time: "14:00", staffName: "Rafael", tenantName: "Barbearia Central" }))
      .toBe("Fechado! Corte e barba confirmado pra sexta-feira, 4 de setembro às 14:00 com Rafael. Te esperamos na Barbearia Central. Até lá!");
    expect(mainMenu({ humanHandoff: true })).toContain("chamar alguém da equipe");
    expect(mainMenu({ humanHandoff: false })).not.toContain("equipe");
  });

  it("repete a pergunta do passo quando não entende", () => {
    expect(didNotUnderstand({ hint: hintFor("SERVICE_SELECTION", items(["Corte", "Barba"])) }))
      .toBe("Não entendi. Me diz qual serviço: corte ou barba?");
    expect(hintFor("SLOT_SELECTION", [...slots(["14:00", "15:30"]), { key: "9", label: "Escolher outra data" }]))
      .toBe("Os horários são 14:00 ou 15:30 — qual serve? Se preferir outro dia, é só dizer.");
    expect(didNotUnderstand({ configured: "Ops, não peguei.", hint: hintFor("CUSTOMER_IDENTIFICATION", []) }))
      .toBe("Ops, não peguei. Me diz seu nome completo, por favor.");
  });

  it("nunca usa emoji nem lista numerada curta", () => {
    const samples = [
      askService({ services: items(["Corte", "Barba"]) }),
      askStaff({ service: "Corte", staff: items(["Rafael"]) }),
      offerSlots({ dayLabel: "hoje", slots: slots(["14:00"]) }),
      review({ service: "Corte", longDay: "hoje", time: "14:00", staffName: null, customerName: "Ana" }),
    ];
    for (const sample of samples) {
      expect(sample).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(sample).not.toMatch(/^\d+ — /m);
    }
  });
});
