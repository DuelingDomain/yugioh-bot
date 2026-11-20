/** Where my given card lies on my own mat: the camera keeps seeing the paper card there after an opponent took the proxy. `at` is when it was given (performance.now). */
export type GivenSpot={zone:string;cardId?:string;at:number};

/**
 * Hold a camera track by identity: it lies on the mat spot of a given card and is that card.
 * - The face must match the given card's current face (`given` reads the copy on the other seat), so a face-down Set on the spot of a face-up given card is a new card.
 * - A known given card holds an unread track or a track of the same card id. An unknown one (a face-down card taken with a code the table never named) holds unread tracks only, never a named one.
 * - The spot is released once the cell has a learned-empty proof newer than the give: the paper card left, so a new card there is a new card.
 * `given` returns the copy of the card while it is still given away, or undefined.
 */
export function givenSpotHolds(spots:ReadonlyMap<string,GivenSpot>,track:{zone:string;cardId?:string;faceDown:boolean},given:(ref:string)=>{faceUp:boolean}|undefined,emptyProofAt:(zone:string)=>number|undefined):boolean {
  for(const [ref,spot] of spots){
    if(spot.zone!==track.zone)continue;
    const copy=given(ref);if(!copy||track.faceDown!==!copy.faceUp)continue;
    if((emptyProofAt(spot.zone)??-Infinity)>spot.at)continue;
    if(!track.cardId||spot.cardId&&track.cardId===spot.cardId)return true;
  }
  return false;
}
