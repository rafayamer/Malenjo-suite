/** Keyboard focus moves to an executable option, never a disabled action. */
export function firstAvailableCommand(items: ReadonlyArray<{ disabled?: boolean }>): number {
  return items.findIndex((item) => !item.disabled);
}

export function moveAvailableCommand(
  items: ReadonlyArray<{ disabled?: boolean }>,
  currentIndex: number,
  direction: -1 | 1,
): number {
  if (!items.length) return -1;
  for (let step = 1; step <= items.length; step++) {
    const next = ((currentIndex + step * direction) % items.length + items.length) % items.length;
    if (!items[next].disabled) return next;
  }
  return -1;
}
