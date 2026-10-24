if not (Duel.MPMode and Duel.MPMode()==1) then return end
-- R-FFA-LP-COMPARE (#449): protection belongs to the damaged player, and
-- requires strictly lower LP than every other living player, regardless of
-- the Field Spell's controller or a bound attack/effect opponent.
local stock_initial_effect=s.initial_effect
function s.initial_effect(c)
	-- A copying card can already own unrelated damage effects.
	local existing={}
	for _,e in ipairs({c:GetOwnEffects()}) do existing[e]=true end
	stock_initial_effect(c)
	for _,e in ipairs({c:GetOwnEffects()}) do
		if not existing[e] and (e:GetCode()==EFFECT_CHANGE_DAMAGE or e:GetCode()==EFFECT_NO_EFFECT_DAMAGE) then e:Reset() end
	end
	-- initial_effect can run before the card has an owner, with no Lua seat
	-- scope. Explicit action seats also work when an existing card copies it.
	for seat=0,3 do
		if Duel.MPIsAlive(seat) then
			local e1=Effect.CreateEffect(c)
			e1:SetType(EFFECT_TYPE_FIELD)
			e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
			e1:SetCode(EFFECT_CHANGE_DAMAGE)
			e1:SetRange(LOCATION_FZONE)
			-- Absolute self range targets precisely this seat even if control changes.
			e1:SetOwnerPlayer(Duel.MPActionSeat(seat))
			e1:SetAbsoluteRange(e1:GetOwnerPlayer(),1,0)
			e1:SetCondition(function() return aux.MPCompareLPSeat(seat,"<") end)
			e1:SetValue(0)
			c:RegisterEffect(e1)
			local e2=e1:Clone()
			e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)
			c:RegisterEffect(e2)
		end
	end
end
