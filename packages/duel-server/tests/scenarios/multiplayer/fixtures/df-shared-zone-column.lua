-- The official IsColumn predicate runs on foreign cards in a real Spell operation.
local s,id=GetID()
function s.initial_effect(c)
	local capture=Effect.GlobalEffect()
	capture:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
	capture:SetCode(EVENT_STARTUP)
	capture:SetOperation(function()
		local seat=id-95200154
		s.card=Duel.GetFieldCard(seat,LOCATION_MZONE,seat==3 and 3 or 1)
	end)
	Duel.RegisterEffect(capture,0)
	local e=Effect.CreateEffect(c)
	e:SetType(EFFECT_TYPE_ACTIVATE)
	e:SetCode(EVENT_FREE_CHAIN)
	e:SetOperation(function(e,tp)
		local saved=Duel.MPSeatBinding()
		Duel.MPBindSeat(2)
		local expected=id~=95200155
		assert(s.card:IsColumn(1,1,LOCATION_MZONE)==expected,'foreign column comparison must use exact own, side and across seats')
		assert(s.card:IsColumn(s.card:GetSequence()),'the default view is the card own column')
		if saved==255 then Duel.MPBindSeat() else Duel.MPBindSeat(saved) end
		Duel.Draw(tp,1,REASON_EFFECT)
	end)
	c:RegisterEffect(e)
end
