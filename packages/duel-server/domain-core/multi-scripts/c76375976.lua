if not aux.MPAny then return end
-- Mystic Mine: the two continuous conditions and the trigger ask about any one opponent (any opponent, not a picked one).
-- Target chk==0 of the trigger repeats the compare.
function s.conself(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)>Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
function s.conopp(e)
	local tp=e:GetHandlerPlayer()
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)<Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
function s.descon(e,tp,eg,ep,ev,re,r,rp)
	return aux.MPAny(function() return Duel.GetFieldGroupCount(tp,LOCATION_MZONE,0)==Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE) end)()
end
function s.destg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return s.descon(e,tp,eg,ep,ev,re,r,rp) end
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)
end
