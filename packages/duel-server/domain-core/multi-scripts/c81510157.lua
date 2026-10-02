if not aux.MPForEachController then return end
-- Soul Taker (script fix, R1 target controller, R-COMMON-SEAT-STATE): "Target 1 face-up monster your opponent controls; destroy it, then your
-- opponent gains 1000 LP". The stock script reads "your opponent" as the Lua value 1-tp, which in FFA is ONE opponent chosen by a window
-- ("Choose an opponent"), not the controller of the target: the user could give the 1000 LP to any opponent. The LP now go to the controller of
-- the destroyed monster (aux.MPForEachController binds the Lua value 1 to that seat), in Tag to the team of that controller. Two seats: the stock script.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsControler(1-tp) and chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() end
	if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
	aux.MPForEachController(g,function(sg,seat,p)
		Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,p,1000)
	end)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsFaceup() and tc:IsRelateToEffect(e) then
		aux.MPForEachController(Group.FromCards(tc),function(sg,seat,p)
			if Duel.Destroy(tc,REASON_EFFECT)>0 then
				Duel.BreakEffect()
				Duel.Recover(p,1000,REASON_EFFECT)
			end
		end)
	end
end
