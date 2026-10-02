-- Grass checks each eligible opponent, then mills against the bound Deck.
-- Tag also uses ONE declared opposing duelist and only the acting Deck (owner answer 2026-10-02).
local mp_condition,mp_target=s.condition,s.target
local function mp_tag_counts(tp)
	local own=Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)
	local me,counts=aux.MPKey(tp),{}
	aux.MPForEachDuelist(function(p,seat)
		if aux.MPKeyOfSeat(seat)~=me then
			local ct=own-Duel.GetFieldGroupCount(p,LOCATION_DECK,0)
			if ct>0 then counts[#counts+1]=ct end
		end
	end)
	return counts
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
	if Duel.MPMode()==2 and not Duel.MPBound() then return #mp_tag_counts(tp)>0 end
	return aux.MPAny(mp_condition)(e,tp,eg,ep,ev,re,r,rp)
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 and Duel.MPMode()==2 and not Duel.MPBound() then
		Duel.MPNeedPick()
		for _,ct in ipairs(mp_tag_counts(tp)) do
			if Duel.IsPlayerCanDiscardDeck(tp,ct) then return true end
		end
		return false
	end
	return aux.MPAny(mp_target)(e,tp,eg,ep,ev,re,r,rp,chk)
end
s.activate=aux.MPOne(s.activate)
