if not aux.MPChooseOpponent then return end
-- The Monarchs Revolt: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.thtgop(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetMatchingGroup(s.revfilter,tp,LOCATION_DECK,0,nil)
	if #g>=3 and g:IsExists(Card.IsAbleToHand,1,nil) then
		local rg=aux.SelectUnselectGroup(g,e,tp,3,3,s.rescon,1,tp,HINTMSG_CONFIRM)
		if not aux.MPChooseOpponent(tp) then return end
		Duel.ConfirmCards(1-tp,rg)
		Duel.Hint(HINT_SELECTMSG,1-tp,aux.Stringid(id,2))
		local sc=rg:FilterSelect(1-tp,Card.IsAbleToHand,1,1,nil):GetFirst()
		Duel.SendtoHand(sc,nil,REASON_EFFECT)
		Duel.SendtoGrave(rg-sc,REASON_EFFECT)
	end
	if not e:IsHasType(EFFECT_TYPE_ACTIVATE) then return end
	--You cannot Special Summon from the Extra Deck for the rest of this turn after this card resolves
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetDescription(aux.Stringid(id,3))
	e1:SetType(EFFECT_TYPE_FIELD)
	e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
	e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
	e1:SetTargetRange(1,0)
	e1:SetTarget(function(e,c) return c:IsLocation(LOCATION_EXTRA) end)
	e1:SetReset(RESET_PHASE|PHASE_END)
	Duel.RegisterEffect(e1,tp)
end
