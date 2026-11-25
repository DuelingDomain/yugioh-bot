import { useCallback, useState } from "react";

/** The seat shown large in a 3-way table (desktop) and in the focus view of a 3-way or 4-way table (phone). */
export type SeatFocus = { big: boolean; tile: boolean; onPick: () => void };

/**
 * My own seat is always a small seat on a desktop 3-way table: I see my real cards on my desk. The large seat is the opponent whose turn it is.
 * In my own turn it is the next player, or the opponent I clicked last. A seat without a camera (bot, manual) gives way to an opponent who has one. A click on a small seat makes it the large one until the turn changes.
 * The phone focus view uses the same pick, and also lets me focus my own seat.
 */
export function useSeatFocus({ seatCount, mySeat, turnSeat, nextSeat, turn, seats, hasCamera }: { seatCount: number; mySeat: number; turnSeat: number; nextSeat: number; turn: number; seats: number[]; hasCamera: (seat: number) => boolean }) {
  const [pick, setPick] = useState<{ seat: number; turn: number } | null>(null);
  const picked = pick && pick.turn === turn ? pick.seat : -1;
  const opponents = seats.filter(seat => seat !== mySeat);
  const ruled = turnSeat >= 0 && turnSeat !== mySeat ? turnSeat : nextSeat >= 0 && nextSeat !== mySeat ? nextSeat : (opponents[0] ?? seats[0] ?? 0);
  // A human opponent with a webcam is the better large seat than a bot or manual seat: the ruled seat first, then the turn order after it.
  const order = [ruled, ...opponents.filter(seat => seat !== ruled)];
  const byRule = hasCamera(ruled) ? ruled : (order.find(seat => hasCamera(seat)) ?? ruled);
  const bigDesktop = picked >= 0 && picked !== mySeat ? picked : byRule;
  const bigPhone = picked >= 0 ? picked : byRule;
  return useCallback((seat: number): SeatFocus | undefined => seatCount < 3 ? undefined
    : { big: seatCount === 3 && seat === bigDesktop, tile: seat !== bigPhone, onPick: () => setPick({ seat, turn }) }, [seatCount, bigDesktop, bigPhone, turn]);
}
