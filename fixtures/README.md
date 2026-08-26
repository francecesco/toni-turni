# Fixtures

Foto reali della tabella turni, usate come **golden test** dell'estrazione AI.

| File | Contenuto |
|---|---|
| `roster-2026-08-3piano.jpeg` | Agosto 2026, 3° Piano. Caso difficile: correzioni a penna, celle coperte con correttore e riscritte a mano, evidenziature a colori. |
| `roster-2026-09-3piano.jpeg` | Settembre 2026, 3° Piano. Tabella pulita, ma fotografata in prospettiva. |

Per ogni immagine c'è un `<nome>.expected.json` con la trascrizione di riferimento: è il metro
contro cui `npm run eval` misura l'accuratezza per cella.

**Come è stata prodotta:** ogni foto è stata trascritta due volte da due lettori indipendenti, che
non si sono visti fra loro, e le due letture sono state confrontate cella per cella. Concordano al
100% su entrambe le foto (240/240 a settembre, 248/248 ad agosto), spaziature comprese. Dove
divergevano — su quali celle contare come "corrette a mano" — la differenza è registrata nel file:
`handCorrected` contiene le 10 correzioni vere (correttore bianco e pennarello verde), mentre
`penAnnotations` contiene 5 annotazioni a penna che aggiungono un orario **senza** cambiare il turno.
Se l'estrazione automatica marcasse queste ultime come correzioni, sarebbe un falso positivo, non un
errore di lettura.

**Resta da fare:** nessuno che conosca il reparto ha ancora verificato questi file (`"verified": false`).
Le percentuali di accuratezza valgono quanto la trascrizione, e il punto meno certo è annotato in
`_daVerificare` nel file di agosto.

I dati nelle immagini sono **fittizi**: nomi e turni non corrispondono a persone reali, quindi le
foto possono stare nel repository. Le tabelle caricate in produzione contengono invece dati veri e
non vanno mai committate (`uploads/` e `data/` sono in `.gitignore`).
