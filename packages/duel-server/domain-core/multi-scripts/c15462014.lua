if not aux.MPForEachDuelist then return end
-- 1000 damage "to a player(s)": every duelist that controls a card of eg is damaged. Stock loops i=0,1 with Card.IsControler, which folds
-- every opponent seat to 1. The cards are grouped by their real controller (aux.MPForEachController) and the damage goes to that seat.
function s.damop(e,tp,eg,ep,ev,re,r,rp)
	local c=e:GetHandler()
	if c:IsRelateToEffect(e) and Duel.SendtoGrave(c,REASON_COST)~=0 then
		aux.MPForEachController(eg,function(sg,seat,p)
			Duel.Damage(p,1000,REASON_EFFECT)
		end)
	end
end
