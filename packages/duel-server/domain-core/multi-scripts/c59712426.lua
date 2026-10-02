if not aux.MPForEachController then return end
-- The Heads effect damages the destroyed target's controller, not the battle opponent.
function s.hdestg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) end
	if chk==0 then return Duel.IsExistingTarget(nil,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,nil,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
	aux.MPForEachController(g,function(cards,seat,p)
		Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,p,500)
	end)
end
function s.hdesop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if not tc or not tc:IsRelateToEffect(e) then return end
	aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
		if Duel.Destroy(tc,REASON_EFFECT)>0 then Duel.Damage(p,500,REASON_EFFECT) end
	end)
end
