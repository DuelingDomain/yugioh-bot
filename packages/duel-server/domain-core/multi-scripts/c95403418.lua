if not aux.MPAny then return end
-- Starduston: the continuous self-destroy condition asks if any one opponent controls fewer monsters.
function s.descon(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)<Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0) end)()
end
