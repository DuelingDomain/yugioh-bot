if not aux.MPOne or not Duel.MPTurnSeat then return end
-- Owner 2026-10-18: count the real turn duelist, including separate Tag partners.
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
	local turn=Duel.MPTurnSeat()
	if not Duel.IsMainPhase() or aux.MPKeyOfSeat(turn)==aux.MPKey(tp)
		or s.mp_turn~=Duel.GetTurnCount() or (s.mp_summons[turn] or 0)<5 then return false end
	-- GetTurnPlayer saves the turn opponent on the link. MPTurnSeat alone does not.
	Duel.GetTurnPlayer()
	return true
end
-- FFA: the release group and the Token use just the saved turn opponent.
-- Tag: keep the stock two-side reads and bind the Token to the real turn seat.
local stock_target,stock_operation=s.target,s.operation
local mp_target,mp_operation=aux.MPOne(s.target),aux.MPOne(s.operation)
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if not Duel.MPBindSeat(Duel.MPTurnSeat()) then return false end
	Duel.GetTurnPlayer()
	if Duel.MPMode()==2 then return stock_target(e,tp,eg,ep,ev,re,r,rp,chk) end
	return mp_target(e,tp,eg,ep,ev,re,r,rp,chk)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==2 then
		if not Duel.MPBindSeat(Duel.MPTurnSeat()) then return end
		return stock_operation(e,tp,eg,ep,ev,re,r,rp)
	end
	return mp_operation(e,tp,eg,ep,ev,re,r,rp)
end
