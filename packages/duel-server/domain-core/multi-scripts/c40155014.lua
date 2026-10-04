if not Duel.MPActionSeat then return end
if not aux.MPForEachController then return end
-- After banishment the target is controlled by its owner. The delayed summon reads that seat.
function s.rmvop(e,tp,eg,ep,ev,re,r,rp)
	local actor=Duel.MPActionSeat()
	local tc=Duel.GetFirstTarget()
	if tc:IsRelateToEffect(e) and Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)>0 and tc:IsLocation(LOCATION_REMOVED) then
		local turn_ct=Duel.GetTurnCount()
		local reset_ct=Duel.GetCurrentPhase()<=PHASE_STANDBY and 2 or 1
		aux.DelayedOperation(tc,PHASE_STANDBY,id,e,tp,
			function(ag)
				aux.MPForEachController(ag,function(g,seat,p)
					Duel.SpecialSummon(g,0,actor,p,false,false,POS_FACEUP)
				end)
			end,
			function() return Duel.GetTurnCount()==turn_ct+1 end,
			nil,reset_ct)
	end
end
