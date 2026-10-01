if not aux.MPAny then return end
-- Spear Cretin: "each player" is every living duelist (R1). The trigger target takes 1 monster from the Graveyard of you and of each opponent, one after the other.
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return false end
	if chk==0 then return e:GetHandler():GetFlagEffect(id)~=0 end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler(),e,tp)
	aux.MPEachOpponent(function()
		Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_SPSUMMON)
		g:Merge(Duel.SelectTarget(1-tp,s.filter,1-tp,LOCATION_GRAVE,0,1,1,e:GetHandler(),e,1-tp))
	end)()
	if #g>0 then
		Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,g,#g,PLAYER_ALL,g:GetFirst():GetOwner())
	end
end
