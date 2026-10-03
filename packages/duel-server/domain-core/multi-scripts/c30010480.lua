-- FFA4 geometry reads keep their temporary across view separate from the event opponent.
local mp_sumval=s.sumval
function s.sumval(e,c)
 if aux.MPGeometryShared() and not c:IsControler(e:GetHandlerPlayer()) and not c:IsAcross(e:GetHandlerPlayer()) then return 0,0,0 end
 if not aux.MPGeometryShared() then return mp_sumval(e,c) end
	if c:IsControler(e:GetHandlerPlayer()) then
		local sumzone=aux.MPGeometryLinkedZone(e:GetHandler())
		local relzone=-(1<<e:GetHandler():GetSequence())
		return 0,sumzone,relzone
	else
		local sumzone=aux.MPGeometryLinkedZone(e:GetHandler(),1-e:GetHandlerPlayer())
		local relzone=-(1<<e:GetHandler():GetSequence()+16)
		return 0,sumzone,relzone
	end
end
function s.atkcon(e,tp,eg,ep,ev,re,r,rp)
	return eg:IsExists(s.cfilter,1,nil,tp,aux.MPGeometryLinkedZone(e:GetHandler()))
end
s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)
