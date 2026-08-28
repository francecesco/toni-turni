/**
 * Prompt di una **banda**: la colonna dei giorni a sinistra, la riga dei nomi in
 * cima e poche colonne di persona. È diverso dal prompt della tabella intera in
 * tre punti che decidono il risultato:
 *
 * - non chiede `year`, `month` e `ward`, che una banda non mostra;
 * - dichiara l intervallo di giorni e quante colonne aspettarsi, così una riga
 *   o una colonna in più è un segnale di allarme per il modello stesso;
 * - **chiede di riportare anche le celle vuote**: una cella vuota dichiarata
 *   dice "qui non c è scritto niente", una cella assente non dice nulla, e la
 *   differenza fra le due è esattamente ciò che l infermiera deve poter vedere.
 *
 * Non dice di tralasciare le colonne di aiuto e dei totali, al contrario del
 * prompt della tabella intera: qui le colonne si contano e i nomi si leggono, e
 * una colonna saltata farebbe slittare la lettura. Le colonne di servizio si
 * scartano per nome in fase di fusione (vedi `mergeBandExtractions`).
 */
export function buildBandPrompt(
  knownCodes: string[],
  context: { dayFrom: number; dayTo: number; columnCount: number },
): string {
  const elencoCodici =
    knownCodes.length > 0
      ? knownCodes.map((code) => `"${code}"`).join(', ')
      : '(nessun codice noto: riporta esattamente quello che leggi)'

  const giorni = context.dayTo - context.dayFrom + 1

  return `Leggi questo ritaglio di una tabella turni infermieristica e restituisci **esclusivamente JSON**, senza testo prima o dopo.

Il ritaglio è composto così:
- a **sinistra** c è la striscia dei giorni: per ogni riga il numero del giorno e il giorno della settimana abbreviato (lun, mar, mer, gio, ven, sab, dom). **Il giorno di una cella si legge da quella striscia**, non dalla posizione della riga;
- in **cima** c è la riga d intestazione con i nomi delle colonne, in maiuscolo;
- sotto, ${context.columnCount === 1 ? 'una colonna' : `${context.columnCount} colonne`} di celle: ogni cella contiene il codice del turno di quella colonna in quel giorno.

Questo ritaglio copre le righe **dal giorno ${context.dayFrom} al giorno ${context.dayTo}**, cioè ${giorni} righe, e ha **${context.columnCount}** ${context.columnCount === 1 ? 'colonna' : 'colonne'} oltre alla striscia dei giorni. Se ne conti un numero diverso, riporta quello che vedi davvero e abbassa la confidenza.

Codici turno che il reparto usa: ${elencoCodici}. Se leggi qualcosa che non è in questo elenco, riportalo comunque come lo vedi: **non sostituirlo** con il codice più somigliante. Un codice che non conosco non è un problema, lo risolvo dopo.

Regole importanti:
1. In "columns" elenca i nomi delle colonne **come sono scritti nell intestazione** del ritaglio, nell ordine da sinistra a destra, senza la striscia dei giorni. Ogni valore di "column" dentro "cells" deve essere uno di quei nomi, scritto allo stesso modo.
2. Restituisci una cella per **ogni** incrocio giorno/colonna del ritaglio, comprese **anche** le righe **vuote**: se una cella è vuota metti "code": "". Una cella vuota dichiarata mi serve; una cella che manca mi lascia nel dubbio se il foglio fosse vuoto o se tu non l abbia letta. Mi aspetto ${giorni} × ${context.columnCount} celle.
3. Se una cella è stata corretta a **penna**, coperta con il correttore e riscritta, o comunque modificata a mano, metti "handCorrected": true. È l informazione più preziosa che puoi darmi: quelle celle verranno rilette da una persona.
4. La "confidence" è quanto sei sicuro di quella cella, da 0 a 1. Usa **valori bassi quando non sei sicuro**: è molto meglio una confidenza bassa che un codice inventato. Non inventare mai il contenuto di una cella illeggibile — riportala con "code": "" e confidenza bassa.

Formato JSON richiesto:
{
  "columns": ["RENATA", "KHADIJA"],
  "cells": [
    { "day": ${context.dayFrom}, "column": "RENATA", "code": "M", "confidence": 0.97, "handCorrected": false },
    { "day": ${context.dayFrom}, "column": "KHADIJA", "code": "", "confidence": 0.9, "handCorrected": false },
    { "day": ${context.dayFrom + 1}, "column": "RENATA", "code": "P", "confidence": 0.55, "handCorrected": true }
  ]
}`
}
