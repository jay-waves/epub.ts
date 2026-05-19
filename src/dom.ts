export function queryRequired<T extends Record<string, Element>>(selectors: {
  [Key in keyof T]: string;
}) {
  const elements = {} as T;

  for (const [key, selector] of Object.entries(selectors)) {
    const node = document.querySelector(selector);
    if (!node) {
      throw new Error(`Missing required element: ${selector}`);
    }
    elements[key as keyof T] = node as T[keyof T];
  }

  return elements;
}
