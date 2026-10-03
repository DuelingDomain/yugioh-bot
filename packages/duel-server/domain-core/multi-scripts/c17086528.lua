if not aux.MPAny then return end
-- Xiangsheng Magician: continuous condition on the Pendulum Scale. True when any one opponent controls fewer cards.
function s.slcon(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_ONFIELD,0)>Duel.GetFieldGroupCount(tp,0,LOCATION_ONFIELD) end)()
end
