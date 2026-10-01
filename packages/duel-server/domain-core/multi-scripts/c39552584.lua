if not aux.MPForEachDuelist then return end
-- First effect: the chain link that Grapha changes runs the new operation as ITS OWN link (the scope is the duelist that activated it, with
-- no bound opponent), so the stock "1-tp" reads the other side of that duelist and asks for a bind in an operation (trap c). The duelist that
-- discards is always the controller of Grapha (the stock script checks the hand of this duelist when it activates), so the seat is read here
-- and bound again in the new operation (Duel.MPBindSeat). A controller that is out of the duel, or the own team of the activator, gives an
-- empty other side: nothing is discarded.
function s.chop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	Duel.ChangeTargetCard(ev,g)
	local seat=Duel.MPSeatOf(e:GetHandler())
	Duel.ChangeChainOperation(ev,function(e2,tp2,eg2,ep2,ev2,re2,r2,rp2)
		Duel.MPBindSeat(seat)
		return s.repop(e2,tp2,eg2,ep2,ev2,re2,r2,rp2)
	end)
end
-- After the Special Summon every duelist discards 1 card (R1, Q3, Tag partner included). The condition asks if ANY duelist has a card in
-- hand. The duelist that runs the effect discards first.
function s.spop(e,tp,eg,ep,ev,re,r,rp)
	if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
	local g=Duel.SelectMatchingCard(tp,aux.NecroValleyFilter(s.spfilter),tp,LOCATION_GRAVE|LOCATION_REMOVED,0,1,1,nil,e,tp)
	if #g>0 and Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)>0
		and aux.MPAnyDuelist(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>0 end) then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i)
			Duel.DiscardHand(tp_i,nil,1,1,REASON_EFFECT|REASON_DISCARD)
		end)
	end
end
