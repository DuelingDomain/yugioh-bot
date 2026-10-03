if not Duel.MPSeatOf or not Duel.MPBindSeat then return end
-- A temporary banishment keeps the real hand controller until the delayed return.
s.mp_return_seat={}
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	local g=Duel.GetFieldGroup(1-tp,LOCATION_HAND,0)
	if #g==0 or not c:IsRelateToEffect(e) or not c:IsFaceup() then return end
	local hg=g:RandomSelect(1-tp,1)
	if #hg~=1 then return end
	local tc=hg:GetFirst()
	s.mp_return_seat[tc]=Duel.MPSeatOf(tc)
	local rg=hg+c
	if Duel.Remove(rg,POS_FACEUP,REASON_EFFECT|REASON_TEMPORARY)==0 then
		s.mp_return_seat[tc]=nil
		return
	end
	local retg=c:HasFlagEffect(id) and rg or hg
	retg:Match(Card.IsLocation,nil,LOCATION_REMOVED)
	aux.DelayedOperation(retg,PHASE_STANDBY,id+1,e,tp,s.retop,s.retcon,RESET_PHASE|PHASE_STANDBY|RESET_SELF_TURN)
end
function s.retop(rg,e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	for tc in rg:Iter() do
		if tc==c then
			Duel.ReturnToField(tc)
		else
			local seat=s.mp_return_seat[tc]
			if seat~=nil and Duel.MPBindSeat(seat) then
				Duel.SendtoHand(tc,tc:GetPreviousControler(),REASON_EFFECT)
			end
			Duel.MPBindSeat()
			s.mp_return_seat[tc]=nil
		end
	end
end
