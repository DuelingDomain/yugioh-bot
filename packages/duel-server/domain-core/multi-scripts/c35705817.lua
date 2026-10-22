if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.fextra(e,tp,mg)
	if aux.MPCompareLP(tp,"<") and not Duel.IsPlayerAffectedByEffect(tp,CARD_SPIRIT_ELIMINATION) then
		local eg=Duel.GetMatchingGroup(s.exfilter0,tp,LOCATION_MZONE|LOCATION_HAND_DECK_GRAVE,0,nil)
		if #eg>0 then
			return eg,s.fcheck
		end
	end
	return nil
end
