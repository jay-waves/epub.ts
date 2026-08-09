type ReaderRenderControllerOptions = {
  root: HTMLElement;
};

export function createReaderRenderController(options: ReaderRenderControllerOptions) {
  let pendingToken = 0;

  const begin = () => {
    pendingToken += 1;
    options.root.classList.add("reader-frame--pending");
  };

  const end = () => {
    options.root.classList.remove("reader-frame--pending");
  };

  const revealAfterPaint = async () => {
    const token = pendingToken;
    await waitForNextPaint();
    if (token === pendingToken) end();
  };

  const run = async (action: () => Promise<unknown> | undefined) => {
    begin();
    try {
      await action();
      await revealAfterPaint();
    } catch (error) {
      end();
      throw error;
    }
  };

  return {
    begin,
    end,
    isPending: () => options.root.classList.contains("reader-frame--pending"),
    revealAfterPaint,
    run,
  };
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
