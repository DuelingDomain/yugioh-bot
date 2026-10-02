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
		if tc:IsType(TYPE_SYNCHRO) and tc:IsPreviousLocation(LOCATION_MZONE)
			and ((tc:IsReason(REASON_BATTLE) and (tc:GetBattlePosition()&POS_FACEUP)~=0)
			or (not tc:IsReason(REASON_BATTLE) and tc:IsPreviousPosition(POS_FACEUP)))
			and aux.MPKey(tc:GetPreviousControler())~=aux.MPKey(tc:GetReasonPlayer()) then
				mp_mark(hit,tc:GetReasonPlayer())
		end
	end
	mp_flag_hits(hit,id,RESET_PHASE|PHASE_END)
end
