export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

