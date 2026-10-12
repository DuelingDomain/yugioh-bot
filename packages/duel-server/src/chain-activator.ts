import { OcgMessageType, OcgResponseType, SelectBattleCMDAction, SelectIdleCMDAction, type OcgMessage, type OcgResponse } from "ocgcore-wasm";
import { TRIGGER_EFFECT_YN_DESCRIPTION } from "./chain-mode.js";

type ForcedActivation = { seat: number; source: Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>["selects"][number] };

/** Display attribution only: retain the answering player through costs/targets until CHAINING. */
export class ChainActivator {
  private seat: number | undefined;
  private previousSeat: number | undefined;
  private resolving = false;
  private adding = false;
  private forced: ForcedActivation[] = [];
  private previousForced: ForcedActivation[] = [];

  recordResponse(seat: number, response: OcgResponse, message?: OcgMessage): void {
    this.previousSeat = this.seat;
    this.previousForced = this.forced.slice();
    switch (response.type) {
      case OcgResponseType.SELECT_IDLECMD:
        this.seat = response.action === SelectIdleCMDAction.SELECT_ACTIVATE ? seat : undefined;
        break;
      case OcgResponseType.SELECT_BATTLECMD:
        this.seat = response.action === SelectBattleCMDAction.SELECT_CHAIN ? seat : undefined;
        break;
      case OcgResponseType.SELECT_CHAIN:
        // Mandatory Quick Effects can be selected for several players before any links are announced.
        if (message?.type === OcgMessageType.SELECT_CHAIN && message.forced) {
          const source = response.index != null ? message.selects[response.index] : undefined;
          if (source) this.forced.push({ seat, source });
          this.seat = undefined;
        } else this.seat = response.index != null ? seat : undefined;
        break;
      case OcgResponseType.SELECT_EFFECTYN:
        // PointEvent uses 221 for a lone optional trigger; PhaseEvent uses 0.
        // Costs/targets run after CHAINING, and a script's yes/no is not a new activation.
        if (!this.adding && !this.resolving && this.seat == null && response.yes
          && message?.type === OcgMessageType.SELECT_EFFECTYN
          && (message.description === TRIGGER_EFFECT_YN_DESCRIPTION || message.description === 0n)) this.seat = seat;
        break;
    }
  }

  /** Consume once per link; an unprompted trigger lets the caller fall back to the card controller. */
  observe(message: OcgMessage): number | undefined {
    switch (message.type) {
      case OcgMessageType.CHAINING: {
        const index = this.forced.findIndex(({ source }) => source.code === message.code && source.description === message.description
          && ((source.controller === message.controller && source.location === message.location && source.sequence === message.sequence)
            || (source.controller === message.triggering_controller && source.location === message.triggering_location && source.sequence === message.triggering_sequence)));
        const seat = index < 0 ? this.seat : this.forced.splice(index, 1)[0]!.seat;
        this.seat = undefined;
        this.adding = true;
        return seat;
      }
      case OcgMessageType.CHAINED:
        this.adding = false;
        break;
      case OcgMessageType.RETRY:
        this.seat = this.previousSeat;
        this.forced = this.previousForced;
        break;
      case OcgMessageType.CHAIN_SOLVING:
        this.adding = false;
        this.resolving = true;
        this.seat = undefined;
        this.forced = [];
        break;
      case OcgMessageType.CHAIN_SOLVED:
      case OcgMessageType.CHAIN_END:
      case OcgMessageType.NEW_TURN:
      case OcgMessageType.NEW_PHASE:
        this.resolving = false;
        this.adding = false;
        this.seat = undefined;
        this.forced = [];
        break;
      case OcgMessageType.SELECT_IDLECMD:
      case OcgMessageType.SELECT_BATTLECMD:
        this.forced = [];
        this.seat = undefined;
        break;
      case OcgMessageType.SELECT_CHAIN:
        this.seat = undefined;
        break;
    }
    return undefined;
  }
}
