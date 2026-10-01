if not aux.MPAny then return end
-- Scramble!! Scramble!!: the condition asks if any one opponent controls more monsters than you have that are not Tokens.
function s.spcon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,0,nil) end)()
end
