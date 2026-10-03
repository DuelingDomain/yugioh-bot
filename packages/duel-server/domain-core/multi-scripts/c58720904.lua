-- Pendransaction checks a legal opponent and uses the bound Extra Deck.
local mp_target=s.target
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 and Duel.MPMode()==2 and not Duel.MPBound() then
		Duel.MPNeedPick()
		local own=Duel.GetFieldGroupCount(tp,LOCATION_EXTRA,0)
		return aux.MPAnyOpponent(tp,function(p) return own>Duel.GetFieldGroupCount(p,LOCATION_EXTRA,0) end)
	end
	return aux.MPAny(mp_target)(e,tp,eg,ep,ev,re,r,rp,chk)
end
s.operation=aux.MPOne(s.operation)
