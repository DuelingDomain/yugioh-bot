if not aux.MPAny then return end
-- Phantom of Yubel: "your opponent destroys 1 Yubel monster" is the duelist who activated the effect (rp), read when the effect is changed.
-- The stock replacement operation uses 1-tp, which is not the activator at 3 or 4 seats.
function s.chngop(e,tp,eg,ep,ev,re,r,rp)
	local g=Group.CreateGroup()
	Duel.ChangeTargetCard(ev,g)
	local p=rp
	Duel.ChangeChainOperation(ev,function()
		Duel.Hint(HINT_SELECTMSG,p,HINTMSG_DESTROY)
		local dg=Duel.SelectMatchingCard(p,s.yubelfilter,p,LOCATION_HAND|LOCATION_MZONE|LOCATION_DECK,0,1,1,nil)
		if #dg>0 then
			Duel.Destroy(dg,REASON_EFFECT,LOCATION_GRAVE,p)
		end
	end)
end
