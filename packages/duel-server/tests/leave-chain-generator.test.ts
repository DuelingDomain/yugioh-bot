import { describe, expect, it } from "vitest";
import { leaveChainPatterns } from "../scripts/generate-multi-scripts.js";

describe("leave-chain script scan", () => {
  it("finds complete chain loops and ev-1 reads without changing their stored IDs", () => {
    expect(leaveChainPatterns(`for i=1,ev do local te=Duel.GetChainInfo(i,CHAININFO_TRIGGERING_EFFECT) end`)).toEqual(["stored-link-loop"]);
    expect(leaveChainPatterns(`Duel.GetChainInfo(ev - 1,CHAININFO_TRIGGERING_EFFECT):IsHasType(EFFECT_TYPE_ACTIVATE)`)).toEqual(["stored-previous-link"]);
  });

  it("ignores commented examples", () => {
    expect(leaveChainPatterns(`-- for i=1,ev do\n-- Duel.GetChainInfo(ev-1,CHAININFO_TRIGGERING_EFFECT)\n-- count>=ev-1`)).toEqual([]);
  });

  it("keeps overlay-material event counts separate from chain readers", () => {
    const source = `local s,id=GetID()
function s.condition(e,tp,eg,ep,ev,re,r,rp)
 return re:GetHandler():GetOverlayCount() >= ev - 1
end
function s.operation(e,tp) Duel.Draw(tp,1,REASON_EFFECT) end`;
    expect(leaveChainPatterns(source)).toEqual(["overlay-material-count"]);
    expect(leaveChainPatterns(`function s.condition() return true end`)).toEqual([]);
    expect(leaveChainPatterns(`return count>=ev-1`)).toEqual(["event-value-count"]);
  });
});
