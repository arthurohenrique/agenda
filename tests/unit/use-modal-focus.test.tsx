import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useModalFocus } from "@/hooks/use-modal-focus";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  const { dialogRef, triggerRef } = useModalFocus<HTMLButtonElement, HTMLDivElement>({
    onClose: () => setOpen(false),
    open,
  });

  return (
    <>
      <button onClick={() => setOpen(true)} ref={triggerRef} type="button">
        Abrir
      </button>
      {open ? (
        <div aria-labelledby="test-dialog-title" ref={dialogRef} role="dialog" tabIndex={-1}>
          <h2 id="test-dialog-title">Diálogo de teste</h2>
          <button data-modal-initial-focus onClick={() => setOpen(false)} type="button">
            Fechar
          </button>
          <button type="button">Final</button>
        </div>
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = "";
});

describe("useModalFocus", () => {
  it("prende o foco, fecha com Escape e devolve o foco ao gatilho", async () => {
    const rect = {} as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
      [rect] as unknown as DOMRectList,
    );
    render(<ModalHarness />);
    const trigger = screen.getByRole("button", { name: "Abrir" });

    fireEvent.click(trigger);

    const close = screen.getByRole("button", { name: "Fechar" });
    const last = screen.getByRole("button", { name: "Final" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
});
