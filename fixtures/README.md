# Fixtures

Foto reali della tabella turni, usate come **golden test** dell'estrazione AI.

| File | Contenuto |
|---|---|
| `roster-2026-08-3piano.jpeg` | Agosto 2026, 3° Piano. Caso difficile: correzioni a penna, celle coperte con correttore e riscritte a mano, evidenziature a colori. |
| `roster-2026-09-3piano.jpeg` | Settembre 2026, 3° Piano. Tabella pulita, ma fotografata in prospettiva. |

Per ogni immagine va mantenuto un `<nome>.expected.json` con la trascrizione corretta, verificata a
mano. È il riferimento contro cui `npm run eval` misura l'accuratezza per cella.

**Attenzione:** contengono nomi e assenze di persone reali. Il repository deve restare privato.
