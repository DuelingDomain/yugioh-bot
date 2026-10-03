if not aux.MPKey then return end
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=eg:Filter(function(c) return c:IsPreviousLocation(LOCATION_MZONE) and c:IsMonster() end,nil)
	aux.MPForEachController(g,function(sg,seat,p)
		Duel.Damage(p,500*#sg,REASON_EFFECT)
	end)
end
