export function createRenderState(root: HTMLElement) {
  let pendingToken = 0;

  const begin = () => {
    pendingToken += 1;
    root.classList.add("reader-frame--pending");
  };

  const end = () => {
    root.classList.remove("reader-frame--pending");
  };

  const revealAfterPaint = async () => {
    const token = pendingToken;
    await waitForNextPaint();
    if (token === pendingToken) end();
  };

  const run = async <Result>(action: () => Promise<Result> | Result) => {
    begin();
    try {
      const result = await action();
      await revealAfterPaint();
      return result;
    } catch (error) {
      end();
      throw error;
    }
  };

  return {
    begin,
    end,
    isPending: () => root.classList.contains("reader-frame--pending"),
    revealAfterPaint,
    run,
  };
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
