-- Bind the forced discard pair before reading either hand or applying the first discard.
s.hdtg=aux.MPTarget(s.hdtg)
s.hdop=aux.MPOne(s.hdop)

s.cfilter=aux.MPGeometryPreviousFilter(s.cfilter)
