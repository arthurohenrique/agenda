import { describe, expect, it } from "vitest";
import { normalizeText } from "@/lib/text/normalize";
import {
  expandSlang,
  extractRequestedStaffName,
  mentionsOtherDate,
  parseAffirmation,
  parseDate,
  parseIntent,
  parseSlotShortcut,
  parseTime,
} from "@/features/whatsapp/domain/intent";

// 2026-08-31 é segunda-feira.
const today = "2026-08-31";
const services = [{ id: "s1", name: "Corte" }, { id: "s2", name: "Corte e barba" }];
const staff = [{ id: "p1", name: "Rafael" }, { id: "p2", name: "Diego" }];

describe("gírias e abreviações", () => {
  it("expande só palavras inteiras", () => {
    expect(expandSlang("hj as 14 hrs")).toBe("hoje as 14 horas");
    expect(expandSlang("hjk")).toBe("hjk");
    expect(expandSlang("vc pode amn?")).toBe("voce pode amanha?");
    expect(expandSlang("dps de amanha")).toBe("depois de amanha");
  });

  it("expande dias abreviados sem confundir com verbo ou mês", () => {
    expect(expandSlang("sex 14h")).toBe("sexta 14h");
    expect(expandSlang("na seg")).toBe("na segunda");
    expect(expandSlang("vou ter que remarcar")).toBe("vou ter que remarcar");
    expect(parseDate(expandSlang(normalizeText("3 set")), { today })?.date).toBe("2026-09-03");
  });

  it("chega ao parser de data e hora", () => {
    const parsed = parseIntent("corte e barba com Raul hj", { today, services, staff });
    expect(parsed).toMatchObject({ service: { id: "s2" }, date: "2026-08-31", staff: null, requestedStaffName: "Raul", matched: true });
    expect(parseIntent("amn 2 da tarde", { today, services, staff })).toMatchObject({ date: "2026-09-01", time: "14:00" });
    expect(parseTime("14 e meia")?.time).toBe("14:30");
    expect(parseTime("2 e meia da tarde")?.time).toBe("14:30");
    expect(parseTime(expandSlang("mei dia"))?.time).toBe("12:00");
  });
});

describe("nome de profissional fora do cadastro", () => {
  it("reconhece 'com <nome>' quando ninguém casa", () => {
    expect(extractRequestedStaffName("corte com raul hoje")).toBe("Raul");
    expect(extractRequestedStaffName("com o joao")).toBe("Joao");
    expect(extractRequestedStaffName("pela carla")).toBe("Carla");
  });

  it("não confunde qualificadores com nome", () => {
    expect(extractRequestedStaffName("com pressa")).toBeNull();
    expect(extractRequestedStaffName("com desconto")).toBeNull();
    expect(extractRequestedStaffName("com voce")).toBeNull();
    expect(extractRequestedStaffName("amanha de tarde")).toBeNull();
  });

  it("só aparece quando o cadastro não resolveu", () => {
    expect(parseIntent("corte com o Rafael", { today, services, staff }).requestedStaffName).toBeNull();
    expect(parseIntent("corte com o Rafael", { today, services, staff }).staff?.id).toBe("p1");
    expect(parseIntent("corte, tanto faz com quem", { today, services, staff }).requestedStaffName).toBeNull();
  });
});

describe("sim, não e atalhos", () => {
  it("classifica respostas fechadas por precedência", () => {
    expect(parseAffirmation("sim")).toBe("yes");
    expect(parseAffirmation("Pode confirmar!")).toBe("yes");
    expect(parseAffirmation("blz")).toBe("yes");
    expect(parseAffirmation("isso mesmo")).toBe("yes");
    expect(parseAffirmation("não")).toBe("no");
    expect(parseAffirmation("n")).toBe("no");
    expect(parseAffirmation("não, outro horário")).toBe("change");
    expect(parseAffirmation("quero mais cedo")).toBe("change");
    expect(parseAffirmation("cancela")).toBe("cancel");
    expect(parseAffirmation("deixa pra lá")).toBe("cancel");
    expect(parseAffirmation("Ana Silva")).toBeNull();
  });

  it("lê atalhos de horário e pedido de outro dia", () => {
    expect(parseSlotShortcut("o primeiro")).toBe("first");
    expect(parseSlotShortcut("pode ser o último")).toBe("last");
    expect(parseSlotShortcut("o mais cedo")).toBe("first");
    expect(parseSlotShortcut("15:30")).toBeNull();
    expect(mentionsOtherDate("prefiro outro dia")).toBe(true);
    expect(mentionsOtherDate("15h")).toBe(false);
  });
});
