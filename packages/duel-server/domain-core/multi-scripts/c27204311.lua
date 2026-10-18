if not aux.MPOne or not Duel.MPTurnSeat then return end
-- Count each real duelist, including separate Tag partners and off-turn summons.
-- Global summon watchers see real seats. A turn number keeps all counts in this turn.
s.mp_summons={}
s.mp_turn=0
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local turn=Duel.GetTurnCount()
	if s.mp_turn~=turn then s.mp_summons={} s.mp_turn=turn end
	for tc in aux.Next(eg) do
		local seat=tc:GetSummonPlayer()
		s.mp_summons[seat]=(s.mp_summons[seat] or 0)+1
	end
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsMainPhase() or s.mp_turn~=Duel.GetTurnCount() then return false end
	return aux.MPAnyOpponent(tp,function(_,seat) return (s.mp_summons[seat] or 0)>=5 end)
end
-- Probe each qualifying opponent in the original holder's scope. The core uses
-- the same target check for the pick list, so opponents below five are excluded.
local stock_target=s.target
local function mp_target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 and not Duel.MPBound() then
		local me=aux.MPKey(tp)
		local candidates={}
		aux.MPForEachDuelist(function(_,seat)
			if aux.MPKeyOfSeat(seat)~=me and (s.mp_summons[seat] or 0)>=5 then candidates[#candidates+1]=seat end
		end)
		for _,seat in ipairs(candidates) do
			if Duel.MPBindSeat(seat) then
				if Duel.MPMode()==1 then Duel.MPWindow(0) end
				local ok=stock_target(e,tp,eg,ep,ev,re,r,rp,0)
				if Duel.MPMode()==1 then Duel.MPWindowEnd() end
				Duel.MPBindSeat()
				if ok then return true end
			end
		end
		return false
	end
	local seat=aux.MPGeometrySeat(1-tp)
	if (s.mp_summons[seat] or 0)<5 then return false end
	return stock_target(e,tp,eg,ep,ev,re,r,rp,chk)
end
-- FFA releases the holder and chosen opponent. Tag keeps both full sides.
-- The link's real chosen seat receives the Token in either format.
s.target=aux.MPTarget(mp_target)
s.operation=aux.MPOne(s.operation)
