if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: unanimous living-opponent conditions; stock amounts/actions.
function s.extrafil(e,tp,mg)
	if aux.MPCompareLP(tp,">") and not Duel.IsPlayerAffectedByEffect(tp,CARD_SPIRIT_ELIMINATION) then
		return Duel.GetMatchingGroup(s.exfilter,tp,LOCATION_GRAVE,0,nil)
	end
	return nil
end
