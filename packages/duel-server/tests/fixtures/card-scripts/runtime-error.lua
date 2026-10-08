-- Test-only card callback; independent of the installed Sabersaurus script.
local s={}
function s.register(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
 e:SetCode(EVENT_BATTLE_START)
 e:SetRange(LOCATION_MZONE)
 e:SetCondition(function() script_error_fixture_missing.failure() end)
 c:RegisterEffect(e)
end
return s
