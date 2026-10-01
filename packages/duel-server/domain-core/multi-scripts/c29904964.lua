if not aux.MPAny then return end
-- Arisen Gaia the Fierce Knight: the Normal Summon without Tribute asks if any one opponent controls more monsters.
function s.ntcon(e,c,minc)
	if c==nil then return true end
	local tp=c:GetControler()
	return minc==0 and c:GetLevel()>4 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)>Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
end
