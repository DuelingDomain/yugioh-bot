if not aux.MPKey then return end
-- Keep the real sides of the LP compare. The global value has no folded player scope.
local mp_eqtg=s.eqtg
local function mp_target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	local result=mp_eqtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chk~=0 then e:SetLabel(id,aux.MPKey(tp),aux.MPKey(1-tp)) end
	return result
end
s.eqtg=Duel.MPMode()==1 and aux.MPTarget(mp_target) or mp_target
function s.effectfilter(e,ct)
	local te=Duel.GetChainInfo(ct,CHAININFO_TRIGGERING_EFFECT)
	local code,own,opponent=te:GetLabel()
	return code==id and own~=nil and opponent~=nil and Duel.GetLP(own)<Duel.GetLP(opponent)
end
