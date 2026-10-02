if not aux.MPAny then return end
-- Toy Knight: the summon procedure asks if any one opponent controls more monsters.
function s.spcon(e,c)
	if c==nil then return true end
	local tp=c:GetControler()
	return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
		and aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
