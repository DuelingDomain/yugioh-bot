if not Duel.MPActionSeat then return end
if not aux.MPForEachController then return end
-- A Graveyard card is controlled by its owner. Read that seat when checking and summoning the target.
function s.spfilter(c,e,tp)
	local actor=Duel.MPActionSeat()
	if not (c:IsSetCard(SET_GIMMICK_PUPPET) or c:IsControler(1-tp)) then return false end
	local ok=false
	aux.MPForEachController(Group.FromCards(c),function(g,seat,p)
		ok=c:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP_DEFENSE,p)
	end)
	return ok
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	local actor=Duel.MPActionSeat()
	local c=e:GetHandler()
	local tc=Duel.GetFirstTarget()
	if not tc or not tc:IsRelateToEffect(e) then return end
	local summoned=false
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		if Duel.SpecialSummonStep(tc,0,actor,p,false,false,POS_FACEUP_DEFENSE) then
			tc:NegateEffects(c)
			summoned=Duel.SpecialSummonComplete()>0
		end
	end)
	if not summoned or not c:IsRelateToEffect(e) then return end
	Duel.BreakEffect()
	Duel.SpecialSummon(c,0,actor,tp,false,false,POS_FACEUP)
end
