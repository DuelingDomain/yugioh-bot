import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from "ocgcore-wasm";
import { mapPrompt, type PendingPrompt } from "./prompts.js";
import type { CardDatabase } from "./cards.js";

type Target = Extract<OcgMessage, { type: OcgMessageType.SELECT_CARD }>["selects"][number];
export interface AttackTargetQuery {
  targets: Target[];
  directSeats: number[];
  costPaid?: boolean;
}

const PREFIX = "YGO_ATTACK_PICK:";

/** Private Lua-to-host report; never a duel message, event or player log line. */
export function readAttackTargetQuery(text: string, query: AttackTargetQuery | null): boolean {
  if (!text.startsWith(PREFIX)) return false;
  if (!query) return true;
  const [kind, ...values] = text.slice(PREFIX.length).split(",");
  const numbers = values.map(Number);
  if (numbers.some(value => !Number.isInteger(value) || value < 0)) throw new Error("Invalid attack target query");
  if (kind === "direct" && numbers.length === 1 && numbers[0]! < 4) query.directSeats.push(numbers[0]!);
  else if (kind === "cost" && numbers.length === 1) query.costPaid = numbers[0] !== 0;
  else if (kind === "monster" && numbers.length === 5) {
    const [controller, location, sequence, code, position] = numbers;
    // The wrapper's controller type is still 0|1; the multi core sends real seats 0..3.
    if (controller! > 3 || location !== OcgLocation.MZONE || sequence! > 6 || position! > 15) throw new Error("Invalid attack target query");
    query.targets.push({ controller: controller as 0 | 1, location: OcgLocation.MZONE, sequence: sequence!, code: code!, position: position as OcgPosition });
  } else throw new Error("Invalid attack target query");
  return true;
}

/**
 * GetAttackableTarget supplies the core's legal monsters and its direct-attack permission (including
 * attack-count and restriction checks). A temporary, non-gameplay effect supplies the attacker's Lua
 * scope. Temporary opponent restrictions let the core report direct permission for one seat at a time.
 * Reset the effect and all probe state before returning; no response or opponent binding is retained.
 */
export const ATTACK_TARGET_QUERY_SCRIPT = `
local c=Duel.GetAttacker()
if not c then error("Attack target query without an attacker") end
Debug.Message("${PREFIX}cost,"..Duel.IsAttackCostPaid())
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_SINGLE)
e:SetCode(0x7F000102)
e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_SET_AVAILABLE)
e:SetCondition(function(e)
 local c=e:GetHandler()
 local targets,direct=c:GetAttackableTarget()
 for tc in targets:Iter() do
  local code=tc:IsFaceup() and tc:GetCode() or 0
  Debug.Message("${PREFIX}monster,"..Duel.MPSeatOf(tc)..","..tc:GetLocation()..","..tc:GetSequence()..","..code..","..tc:GetPosition())
 end
 if direct then
  local seats={}
  for i=1,Duel.MPOppCount() do
   Duel.MPWindow(i)
   seats[#seats+1]=Duel.MPSeat(1)
   Duel.MPWindowEnd()
  end
  for _,seat in ipairs(seats) do
   -- Restrict this probe to one possible defender. Let the core evaluate the full direct-attack
   -- rules instead of duplicating monster-count, immunity, attack-count or protection rules here.
   local restrictions={}
   for i=1,4 do
    local ok,other=Duel.MPNthDuelist(i)
    if not ok then break end
    if other~=Duel.MPSeatOf(c) and other~=seat then
     local lock=Effect.CreateEffect(c)
     lock:SetType(EFFECT_TYPE_FIELD)
     lock:SetCode(EFFECT_CANNOT_BE_DIRECT_ATTACKED)
     lock:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CANNOT_DISABLE)
     lock:SetTargetRange(1,0)
     Duel.RegisterEffect(lock,0)
     restrictions[#restrictions+1]=lock
    end
   end
   Duel.MPNthDuelist(0)
   aux.MPAttackQuerySeat=seat
   local _,allowed=c:GetAttackableTarget()
   aux.MPAttackQuerySeat=nil
   for _,lock in ipairs(restrictions) do lock:Reset() end
   if allowed then Debug.Message("${PREFIX}direct,"..seat) end
  end
  -- GetAttackableTarget refreshes the card's direct-attack mask: restore the unbound mask before
  -- the core consumes the real yes/no and direct-seat responses.
  c:GetAttackableTarget()
 end
 return false
end)
c:RegisterEffect(e)
c:IsHasEffect(0x7F000102)
e:Reset()
`;

export function mergeAttackTargetPick(pending: PendingPrompt, query: AttackTargetQuery, cards: CardDatabase, declaringAttack = false): PendingPrompt {
  const yesNo = pending.message.type === OcgMessageType.SELECT_YESNO;
  const targets = mapPrompt({ type: OcgMessageType.SELECT_CARD, player: pending.seat, min: 1, max: 1,
    can_cancel: yesNo && declaringAttack && query.costPaid === false, selects: query.targets }, cards, pending.id, "Select an attack target");
  return { ...pending, attackTargetPick: true, prompt: { ...targets.prompt, kind: "choice", options: [
    ...targets.prompt.options,
    ...query.directSeats.map(seat => ({ id: `direct:${seat}`, label: `Attack Player ${seat + 1} directly`, controller: seat })),
  ] } };
}
