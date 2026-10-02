if not aux.MPKey then return end
local function mp_mark(hit,p)
	local k=aux.MPKey(p)
	if k>=0 then hit[k]=p end
end
local function mp_flag_hits(hit,code,reset)
	for _,p in pairs(hit) do Duel.RegisterFlagEffect(p,code,reset,0,1) end
end
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	local hit={}
	for tc in aux.Next(eg) do
		if tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsPreviousPosition(POS_DEFENSE)
			and aux.MPKey(tc:GetReasonPlayer())~=aux.MPKey(tc:GetPreviousControler()) then
			mp_mark(hit,tc:GetReasonPlayer())
		end
	end
	mp_flag_hits(hit,id,RESET_PHASE|PHASE_END)
end
