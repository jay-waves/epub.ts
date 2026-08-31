export function createRenderState(root: HTMLElement) {
  let pending = 0;

  const begin = () => {
    pending += 1;
    root.classList.add("reader-frame--pending");
    let active = true;
    const end = () => {
      if (!active) return;
      active = false;
      pending -= 1;
      if (!pending) root.classList.remove("reader-frame--pending");
    };
    return {
      end,
      revealAfterPaint: async () => {
        await waitForNextPaint();
        end();
      },
    };
  };

  const run = async <Result>(action: () => Promise<Result> | Result) => {
    const render = begin();
    try {
      const result = await action();
      await render.revealAfterPaint();
      return result;
    } catch (error) {
      render.end();
      throw error;
    }
  };

  return {
    begin,
    isPending: () => pending > 0,
    run,
  };
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
