if not aux.MPAny then return end
-- Reasoning: the deciding opponent is chosen during resolution (rulebook v1.4).
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	if not Duel.IsPlayerCanSpecialSummon(tp) or not Duel.IsPlayerCanDiscardDeck(tp,1) then return end
	if not aux.MPChooseOpponent(tp) then return end
	Duel.Hint(HINT_SELECTMSG,1-tp,HINTMSG_LVRANK)
	local lv=Duel.AnnounceLevel(1-tp)
	local g=Duel.GetMatchingGroup(Card.IsSummonableCard,tp,LOCATION_DECK,0,nil)
	local dcount=Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)
	local seq=-1
	local spcard=nil
	for tc in g:Iter() do
		if tc:GetSequence()>seq then
			seq=tc:GetSequence()
			spcard=tc
		end
	end
	if seq==-1 then
		Duel.ConfirmDecktop(tp,dcount)
		Duel.ShuffleDeck(tp)
		return
	end
	Duel.ConfirmDecktop(tp,dcount-seq)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and lv~=spcard:GetLevel()
		and spcard:IsCanBeSpecialSummoned(e,0,tp,false,false) then
		Duel.DisableShuffleCheck()
		if dcount-seq==1 then Duel.SpecialSummon(spcard,0,tp,tp,false,false,POS_FACEUP)
		else
			Duel.SpecialSummonStep(spcard,0,tp,tp,false,false,POS_FACEUP)
			Duel.DiscardDeck(tp,dcount-seq-1,REASON_EFFECT)
			Duel.SpecialSummonComplete()
		end
	else
		Duel.DiscardDeck(tp,dcount-seq,REASON_EFFECT|REASON_EXCAVATE)
	end
end
