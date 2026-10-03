if not aux.MPPick or Duel.MPMode()~=1 then return end
-- P68 binds an opposing event player before this target runs (R-FFA-OPP-RESPONSE).
-- MPPick keeps that bind; only an own event needs the activation-time opponent pick.
s.lptg=aux.MPPick(s.lptg)
