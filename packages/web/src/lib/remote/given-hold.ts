/** Where my given card lies on my own mat: the camera keeps seeing the paper card there after an opponent took the proxy. */
export type GivenSpot={zone:string;cardId?:string};

/**
 * Hold a camera track by identity: it lies on the mat spot of a given card and is the same card (an unread track counts).
 * A different, identified card on that spot is not held. `given` says if the card of a ref is still given away.
 */
export function givenSpotHolds(spots:ReadonlyMap<string,GivenSpot>,track:{zone:string;cardId?:string},given:(ref:string)=>boolean):boolean {
  for(const [ref,spot] of spots)if(spot.zone===track.zone&&(!track.cardId||!spot.cardId||track.cardId===spot.cardId)&&given(ref))return true;
  return false;
}
