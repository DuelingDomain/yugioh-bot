if not aux.MPForEachController then return end
-- The 500 damage is for the target controller, not a picked opponent.
function s.damtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
	if chkc then return chkc:IsOnField() end
	if chk==0 then return true end
	Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TARGET)
	local tc=Duel.SelectTarget(tp,nil,0,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil):GetFirst()
	if tc then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,p,500)
		end)
	end
end
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local tc=Duel.GetFirstTarget()
	if tc and tc:IsRelateToEffect(e) then
		aux.MPForEachController(Group.FromCards(tc),function(g,seat,p)
			Duel.Damage(p,500,REASON_EFFECT)
		end)
	end
end
