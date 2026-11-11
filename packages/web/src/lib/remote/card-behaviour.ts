import { createCardBehaviour } from '@yugidraft/shared/remote/card-behaviour';
import data from './card-behaviour-data.json';

/**
 * Card behaviour for Remote Duels, from the engine card scripts (see packages/duel-server/scripts/build-card-behaviour.ts and
 * packages/shared/src/remote/card-behaviour.ts). A prior only: it sets defaults and breaks ties, the camera stays first.
 * A card with no record is unknown, not inert. Alt arts share the record of their card.
 */
const table=createCardBehaviour(data);
/** What the card's script does to the board (hand quick effect, costs, detach, attach, sends), or undefined when unknown. */
export const behaviourOf=(id:number|undefined)=>table.get(id);
