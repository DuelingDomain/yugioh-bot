if not aux.MPForEachController then return end
-- The target fixes the damage recipient; its controller can change on destruction.
function s.target(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() end
	if chk==0 then return Duel.IsExistingTarget(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil) end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
	local g=Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)
	Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,1,0,0)
	aux.MPForEachController(g,function(sg,seat,p)
		Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,p,sg:GetFirst():GetAttack()/2)
	end)
end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsFaceup() and tc:IsRelateToEffect(e) then
		local dam=tc:GetAttack()/2
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			if Duel.Destroy(tc,REASON_EFFECT)~=0 then Duel.Damage(p,dam,REASON_EFFECT) end
		end)
	end
end
