if not aux.MPChooseOpponent then return end
-- Weights & Zenmaisures: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetTargetCards(e):Match(Card.IsFaceup,nil)
	if #g==2 and g:GetClassCount(Card.GetLevel)==2 then
		if not aux.MPChooseOpponent(tp) then return end
		Duel.Hint(HINT_SELECTMSG,1-tp,aux.Stringid(id,1))
		local tc1=g:Select(1-tp,1,1,nil):GetFirst()
		local tc2=g:RemoveCard(tc1):GetFirst()
		local lv1=tc1:GetLevel()
		local lv2=tc2:GetLevel()
		--Change the other monsters level to match the selected monster's
		local e1=Effect.CreateEffect(e:GetHandler())
		e1:SetType(EFFECT_TYPE_SINGLE)
		e1:SetCode(EFFECT_CHANGE_LEVEL)
		e1:SetValue(lv1)
		e1:SetReset(RESETS_STANDARD_PHASE_END)
		tc2:RegisterEffect(e1)
		if lv1<lv2 and Duel.IsPlayerCanDraw(tp,1) and Duel.SelectYesNo(tp,aux.Stringid(id,2)) then
			Duel.BreakEffect()
			Duel.Draw(tp,1,REASON_EFFECT)
		end
	end
end
