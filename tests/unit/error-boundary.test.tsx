import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "@/app/error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("application error boundary logging", () => {
  it("does not duplicate server errors that already have a digest", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorPage
        error={Object.assign(new Error("server error"), { digest: "digest-id" })}
        reset={vi.fn()}
      />,
    );

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("keeps a fixed signal for client-only errors without exposing the message", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<ErrorPage error={new Error("customer@example.com")} reset={vi.fn()} />);

    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith("Unhandled client application error");
  });
});
