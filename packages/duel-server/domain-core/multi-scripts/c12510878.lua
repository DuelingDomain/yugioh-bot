if Duel.MPMode()~=1 then return end
-- R-FFA-LP-COMPARE: gate the bonus unanimously; retain its stock amount formula.
function s.val(e,c)
	if not aux.MPCompareLP(c:GetControler(),">") then return 0 end
	if not (Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsCode,CARD_SANCTUARY_SKY),e:GetHandlerPlayer(),LOCATION_ONFIELD,LOCATION_ONFIELD,1,nil)
		or Duel.IsEnvironment(CARD_SANCTUARY_SKY)) then return 0 end
	local v=Duel.GetLP(c:GetControler())-Duel.GetLP(1-c:GetControler())
	if v>0 then return v else return 0 end
end
