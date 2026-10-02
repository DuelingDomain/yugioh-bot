if not aux.MPForEachController then return end
-- A Union Monster returns to its real controller's field.
function s.spfilter(c,e,tp)
	if not c:IsHasEffect(EFFECT_UNION_STATUS) then return false end
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=c:IsCanBeSpecialSummoned(e,0,tp,false,false,POS_FACEUP,p)
	end)
	return ok
end
function s.tgfilter(c,e,tp)
	if c:GetAttackAnnouncedCount()==0 then return false end
	local g=c:GetEquipGroup():Filter(s.spfilter,nil,e,tp)
	if #g==0 or (#g>1 and Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)) then return false end
	local ok=true
	aux.MPForEachController(g,function(cards,seat,p)
		if Duel.GetLocationCount(p,LOCATION_MZONE)<#cards then ok=false end
	end)
	return ok
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not (tc:IsRelateToEffect(e) and tc:IsFaceup()) then return end
	local g=tc:GetEquipGroup():Filter(s.spfilter,nil,e,tp)
	if #g==0 or (#g>1 and Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)) then return end
	aux.MPForEachController(g,function(cards,seat,p)
		for c in aux.Next(cards) do Duel.SpecialSummonStep(c,0,tp,p,false,false,POS_FACEUP) end
	end)
	if Duel.SpecialSummonComplete()==0 then return end
	local e1=Effect.CreateEffect(e:GetHandler())
	e1:SetType(EFFECT_TYPE_SINGLE)
	e1:SetCode(EFFECT_EXTRA_ATTACK)
	e1:SetValue(tc:GetAttackAnnouncedCount())
	e1:SetReset(RESETS_STANDARD_PHASE_END)
	tc:RegisterEffect(e1)
end
