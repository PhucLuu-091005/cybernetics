export type CardSize = { width: number; height: number; gap: number };
export type CardSlot = { x: number; shelf: number };

// The card starts a little left of its act, so the stem lands inside the card and not on its edge.
export const CARD_INSET = 14;
// Same-day acts are common; letting a card slide right by up to two cards keeps most branches on one shelf.
export const MAX_SLIDE_CARDS = 2;

/** Each card takes the lowest shelf where it fits within the slide; a slid card gets a bent stem. */
export function placeCards(xs: readonly number[], size: CardSize): CardSlot[] {
  const step = size.width + size.gap,
    ends: number[] = [];
  return xs.map((actX) => {
    const wanted = actX - CARD_INSET;
    let shelf = 0;
    while (shelf < ends.length && Math.max(wanted, ends[shelf]) - wanted > MAX_SLIDE_CARDS * step)
      shelf++;
    const x = Math.max(wanted, ends[shelf] ?? -Infinity);
    ends[shelf] = x + step;
    return { x, shelf };
  });
}

export const shelfCount = (slots: readonly CardSlot[]) =>
  slots.reduce((most, slot) => Math.max(most, slot.shelf + 1), 0);
