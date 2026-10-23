if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE (owner 2026-10-22): lower than ALL, otherwise higher;
-- all equal is neutral. Stock recovery/damage amounts and operation stay unchanged.
function s.rectg(e,tp,eg,ep,ev,re,r,rp,chk)
	if chk==0 then return e:IsHasType(EFFECT_TYPE_ACTIVATE) and not aux.MPCompareLP(tp,"==") end
	Duel.SetTargetPlayer(tp)
	if aux.MPCompareLP(tp,"<") then
		e:SetLabel(0)
		Duel.SetTargetParam(2000)
		Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,2000)
	else
		e:SetLabel(1)
		Duel.SetTargetParam(1000)
		Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,1000)
	end
end
