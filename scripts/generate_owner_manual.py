from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "docs" / "images"
OUTPUT = ROOT / "output" / "pdf" / "manual-do-proprietario-agenda.pdf"

INK = colors.HexColor("#18181B")
MUTED = colors.HexColor("#71717A")
SURFACE = colors.HexColor("#F4F4F5")
LINE = colors.HexColor("#E4E4E7")
ACCENT = colors.HexColor("#B45309")
GREEN = colors.HexColor("#047857")


def register_fonts():
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("AgendaSans", str(regular)))
        pdfmetrics.registerFont(TTFont("AgendaSans-Bold", str(bold)))
        return "AgendaSans", "AgendaSans-Bold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


def screenshot(name: str, max_height: float = 105 * mm):
    path = IMAGES / name
    width, height = ImageReader(str(path)).getSize()
    max_width = 180 * mm
    scale = min(max_width / width, max_height / height)
    image = Image(str(path), width=width * scale, height=height * scale)
    image.hAlign = "CENTER"
    return image


def page_frame(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    canvas.setStrokeColor(LINE)
    canvas.line(15 * mm, 14 * mm, 195 * mm, 14 * mm)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(15 * mm, 9 * mm, "Agenda - Manual do proprietário")
    canvas.drawRightString(195 * mm, 9 * mm, str(page))
    canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        "CoverKicker",
        fontName=FONT_BOLD,
        fontSize=10,
        leading=13,
        textColor=ACCENT,
        alignment=TA_CENTER,
        spaceAfter=12,
    )
)
styles.add(
    ParagraphStyle(
        "CoverTitle",
        fontName=FONT_BOLD,
        fontSize=31,
        leading=35,
        textColor=INK,
        alignment=TA_CENTER,
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        "CoverSubtitle",
        fontName=FONT,
        fontSize=13,
        leading=20,
        textColor=MUTED,
        alignment=TA_CENTER,
    )
)
styles.add(
    ParagraphStyle(
        "H1x",
        fontName=FONT_BOLD,
        fontSize=22,
        leading=27,
        textColor=INK,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        "H2x",
        fontName=FONT_BOLD,
        fontSize=14,
        leading=18,
        textColor=INK,
        spaceBefore=8,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        "Bodyx",
        fontName=FONT,
        fontSize=10.2,
        leading=15.5,
        textColor=INK,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        "Smallx",
        fontName=FONT,
        fontSize=8.5,
        leading=12,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        "Bulletx",
        fontName=FONT,
        fontSize=10,
        leading=14.5,
        textColor=INK,
        leftIndent=5 * mm,
        firstLineIndent=-4 * mm,
        spaceAfter=3,
    )
)


def title(text, subtitle=None):
    items = [Paragraph(text, styles["H1x"])]
    if subtitle:
        items.append(Paragraph(subtitle, styles["Bodyx"]))
    items.append(Spacer(1, 3 * mm))
    return items


def bullets(items):
    return [Paragraph(f"- {item}", styles["Bulletx"]) for item in items]


def note(text, tone="neutral"):
    color = GREEN if tone == "success" else ACCENT if tone == "warning" else INK
    table = Table([[Paragraph(text, styles["Bodyx"])]], colWidths=[176 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=16 * mm,
        bottomMargin=20 * mm,
        title="Manual do proprietário - Agenda",
        author="Agenda",
        subject="Uso administrativo do sistema Agenda",
    )

    story = []
    story.extend(
        [
            Spacer(1, 33 * mm),
            Paragraph("MANUAL OPERACIONAL", styles["CoverKicker"]),
            Paragraph("Agenda", styles["CoverTitle"]),
            Paragraph(
                "Guia prático para proprietários e administradores de estabelecimentos",
                styles["CoverSubtitle"],
            ),
            Spacer(1, 22 * mm),
            screenshot("agenda-administrativa.png", 85 * mm),
            Spacer(1, 15 * mm),
            Paragraph("Versão 1.0 - Julho de 2026", styles["Smallx"]),
            PageBreak(),
        ]
    )

    story.extend(title("Comece por aqui", "O essencial para operar com segurança desde o primeiro acesso."))
    story.extend(
        bullets(
            [
                "Acesse o endereço administrativo e entre com seu e-mail individual.",
                "Selecione o estabelecimento correto quando sua conta tiver mais de um acesso.",
                "Use Esqueci minha senha em vez de compartilhar credenciais.",
                "Encerre a sessão em computadores compartilhados.",
            ]
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(note("Nunca envie senha, chave de API ou link privado de recuperação ao suporte.", "warning"))
    story.append(Spacer(1, 8 * mm))
    story.append(Paragraph("Navegação principal", styles["H2x"]))
    nav_data = [
        ["Agenda", "Atendimentos, bloqueios e status"],
        ["Clientes", "Pesquisa e histórico operacional"],
        ["Serviços", "Preço, duração e publicação"],
        ["Equipe", "Profissionais e serviços habilitados"],
        ["Relatórios", "Indicadores dos últimos 30 dias"],
        ["Configurações", "Checklist e publicação da página"],
    ]
    table = Table(nav_data, colWidths=[42 * mm, 125 * mm], repeatRows=0)
    table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
                ("FONTNAME", (1, 0), (1, -1), FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, SURFACE]),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(table)
    story.append(PageBreak())

    story.extend(title("1. Agenda", "A central de operação diária do estabelecimento."))
    story.append(screenshot("agenda-administrativa.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "Alterne entre dia, semana e mês e navegue pelo período.",
                "Filtre por profissional para reduzir a agenda exibida.",
                "Aprove ou recuse solicitações pendentes.",
                "Registre check-in, falta ou cancelamento conforme o atendimento evolui.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("2. Agendar e bloquear", "As duas ações usam a mesma proteção contra sobreposição."))
    story.append(Paragraph("Novo agendamento", styles["H2x"]))
    story.extend(
        bullets(
            [
                "Escolha serviço e profissional.",
                "Informe a data e selecione um horário disponível.",
                "Localize ou cadastre o cliente.",
                "Revise duração e preço antes de confirmar.",
            ]
        )
    )
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Bloqueio", styles["H2x"]))
    story.extend(
        bullets(
            [
                "Use para reunião, manutenção, almoço especial ou indisponibilidade.",
                "Informe início, fim e motivo operacional.",
                "Remova o bloqueio quando o período voltar a ficar disponível.",
            ]
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(note("Se outro usuário ocupar o horário primeiro, o sistema pedirá a escolha de um novo slot.", "success"))
    story.append(PageBreak())

    story.extend(title("3. Clientes", "Dados operacionais ficam separados por estabelecimento."))
    story.append(screenshot("clientes.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "Pesquise por nome ou telefone.",
                "Confirme o estabelecimento selecionado antes de consultar dados.",
                "Registre apenas informações necessárias ao atendimento.",
                "Não copie dados de clientes para planilhas pessoais.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("4. Serviços e equipe", "Mantenha o catálogo consistente com a operação real."))
    story.append(screenshot("servicos.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "Cadastre nome, duração em minutos e preço.",
                "Desative serviços que não devem receber novas reservas.",
                "Associe cada profissional aos serviços que executa.",
                "Marque como público somente o que o cliente pode escolher.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("5. Página pública", "O cliente agenda sem criar uma conta."))
    story.append(screenshot("reserva-publica.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "O cliente escolhe serviço, profissional opcional, data e horário.",
                "Depois informa nome, telefone e campos opcionais.",
                "A disponibilidade é recalculada no momento da confirmação.",
                "Compartilhe somente o endereço público oficial.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("6. Publicação", "O checklist reduz páginas incompletas ou inacessíveis."))
    story.append(screenshot("configuracoes.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "Confirme unidade, serviço, profissional e horários ativos.",
                "Garanta associação entre profissional e serviço.",
                "Revise o contraste visual indicado pelo sistema.",
                "Use Voltar para rascunho para ocultar temporariamente a página.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("7. Relatórios", "Indicadores essenciais dos últimos 30 dias."))
    story.append(screenshot("relatorios.png"))
    story.append(Spacer(1, 4 * mm))
    story.extend(
        bullets(
            [
                "Acompanhe agendamentos, receitas e clientes únicos.",
                "Observe serviços mais agendados.",
                "Monitore cancelamentos e faltas.",
                "Use os números para operação; valide dados antes de decisões financeiras.",
            ]
        )
    )
    story.append(PageBreak())

    story.extend(title("8. Solução de problemas", "Verificações rápidas antes de acionar o suporte."))
    help_rows = [
        ["Não consigo entrar", "Redefina a senha e confirme o e-mail."],
        ["Não há horários", "Revise expediente, equipe, bloqueios e antecedência."],
        ["Serviço não aparece", "Confirme status ativo e público."],
        ["Profissional não aparece", "Confirme status público e associação ao serviço."],
        ["Página não abre", "Revise o checklist de publicação."],
        ["Horário indisponível", "Outro agendamento ou bloqueio ocupou o intervalo."],
    ]
    help_table = Table(help_rows, colWidths=[55 * mm, 112 * mm])
    help_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
                ("FONTNAME", (1, 0), (1, -1), FONT),
                ("FONTSIZE", (0, 0), (-1, -1), 9.2),
                ("LEADING", (0, 0), (-1, -1), 13),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, SURFACE]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(help_table)
    story.append(Spacer(1, 8 * mm))
    story.append(note("Ao pedir ajuda, informe estabelecimento, tela e horário aproximado. Nunca envie senha.", "warning"))

    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    print(OUTPUT)


if __name__ == "__main__":
    build()
