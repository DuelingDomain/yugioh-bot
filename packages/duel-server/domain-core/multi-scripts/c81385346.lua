if not aux.MPForEachController then return end
-- Bind the target's controller before destruction changes the card's location.
function s.activate(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			if Duel.Destroy(tc,REASON_EFFECT)~=0 then Duel.Damage(p,500,REASON_EFFECT) end
		end)
	end
end
