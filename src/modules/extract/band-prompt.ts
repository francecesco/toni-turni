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
 * vecchio prompt della tabella intera: qui le colonne si contano e i nomi si
 * leggono, e una colonna saltata farebbe slittare la lettura. Le colonne di
 * servizio si scartano per nome in fase di fusione (vedi `mergeBandExtractions`).
 *
 * Con `wholeTable` la stessa funzione produce il prompt della **tabella
 * intera**, che è la strategia a chiamata singola. È la stessa funzione di
 * proposito: la tabella intera *è* una banda che tiene tutto, e due prompt
 * gemelli divergerebbero senza che nessuno se ne accorga — è già successo in
 * questo progetto con due nozioni di identità di colonna. Cambia solo quello che
 * cambia davvero nell immagine:
 *
 * - non è un ritaglio, e chiamarlo così inviterebbe il modello a cercare un
 *   pezzo di tabella dove c è tutta;
 * - sopra la riga dei nomi compare la **riga del foglio** (`Piano: 3°PIANO ·
 *   MESE SETTEMBRE · 2026`), che una banda non mostrava mai: contata come riga
 *   d intestazione sposta di una riga la lettura di tutte le colonne;
 * - su 30 righe il modo in cui questo genere di lettura sbaglia è **perdere il
 *   passo fra le righe**, quindi si dichiara un ordine di scansione — giorno per
 *   giorno, dal primo all ultimo — così il modello ha un invariante da tenere
 *   invece di una tabella da guardare a salti.
 *
 * `year`, `month` e `ward` **restano fuori** anche qui, e per la tabella intera
 * è una scelta e non una conseguenza: nell immagine si leggono, ma li conosce
 * già chi ha caricato la foto, e un campo in più nello schema è un campo in più
 * da sbagliare.
 */
export function buildBandPrompt(
  knownCodes: string[],
  context: {
    dayFrom: number
    dayTo: number
    columnCount: number
    /** La banda è la tabella intera: strategia a chiamata singola. */
    wholeTable?: boolean
  },
): string {
  const elencoCodici =
    knownCodes.length > 0
      ? knownCodes.map((code) => `"${code}"`).join(', ')
      : '(nessun codice noto: riporta esattamente quello che leggi)'

  const giorni = context.dayTo - context.dayFrom + 1
  const intera = context.wholeTable === true
  // forma genitiva, perche entra in "nell intestazione di ..."
  const diOggetto = intera ? 'della tabella' : 'del ritaglio'
  const celle = giorni * context.columnCount

  const testa = intera
    ? `Leggi questa tabella turni infermieristica **per intero** e restituisci **esclusivamente JSON**, senza testo prima o dopo.

La tabella è composta così:
- in **alto** c è la riga del foglio, che dice il reparto, il mese e l anno (per esempio "Piano: 3°PIANO   MESE SETTEMBRE   2026"). **Non è una riga di colonne e non contiene turni**: la riga delle colonne è quella immediatamente sotto. Non riportare reparto, mese e anno: li conosco già.`
    : `Leggi questo ritaglio di una tabella turni infermieristica e restituisci **esclusivamente JSON**, senza testo prima o dopo.

Il ritaglio è composto così:`

  return `${testa}
- a **sinistra** c è la striscia dei giorni: per ogni riga il numero del giorno e il giorno della settimana abbreviato (lun, mar, mer, gio, ven, sab, dom). **Il giorno di una cella si legge da quella striscia**, non dalla posizione della riga;
- ${intera ? 'subito **sotto la riga del foglio**' : 'in **cima**'} c è la riga d intestazione con i nomi delle colonne, in maiuscolo;
- sotto, ${context.columnCount === 1 ? 'una colonna' : `${context.columnCount} colonne`} di celle: ogni cella contiene il codice del turno di quella colonna in quel giorno.

${intera ? 'La tabella copre' : 'Questo ritaglio copre'} le righe **dal giorno ${context.dayFrom} al giorno ${context.dayTo}**, cioè ${giorni} righe, e ha **${context.columnCount}** ${context.columnCount === 1 ? 'colonna' : 'colonne'} oltre alla striscia dei giorni. Se ne conti un numero diverso, riporta quello che vedi davvero e abbassa la confidenza.${
    intera
      ? `

Procedi in **ordine**, una riga di giorno alla volta: prima tutte le colonne del giorno ${context.dayFrom}, poi tutte quelle del giorno ${context.dayFrom + 1}, e così via fino al giorno ${context.dayTo}. Prima di passare al giorno successivo, ricontrolla sulla striscia di sinistra che il numero del giorno sia quello che ti aspetti: saltare una riga è l errore che rovina tutta la lettura, e la striscia dei giorni è quello che lo impedisce.`
      : ''
  }

Codici turno che il reparto usa: ${elencoCodici}. Se leggi qualcosa che non è in questo elenco, riportalo comunque come lo vedi: **non sostituirlo** con il codice più somigliante. Un codice che non conosco non è un problema, lo risolvo dopo.

Regole importanti:
1. In "columns" elenca i nomi delle colonne **come sono scritti nell intestazione** ${diOggetto}, nell ordine da sinistra a destra, senza la striscia dei giorni. Ogni valore di "column" dentro "cells" deve essere uno di quei nomi, scritto allo stesso modo.${
    intera
      ? ' La casella d intestazione **sopra la striscia dei giorni** è vuota o porta il nome del reparto: non è una colonna, non elencarla.'
      : ''
  }
2. Restituisci una cella per **ogni** incrocio giorno/colonna ${diOggetto}, comprese **anche** le righe **vuote**: se una cella è vuota metti "code": "". Una cella vuota dichiarata mi serve; una cella che manca mi lascia nel dubbio se il foglio fosse vuoto o se tu non l abbia letta. Mi aspetto ${giorni} × ${context.columnCount} = **${celle}** celle.
3. Se una cella è stata corretta a **penna**, coperta con il correttore e riscritta, o comunque modificata a mano, metti "handCorrected": true. È l informazione più preziosa che puoi darmi: quelle celle verranno rilette da una persona.
4. Se accanto al codice c è un **orario** scritto a penna — per esempio "M 7", "P 13", "h 13:30" — quell orario è un annotazione e **non fa parte del codice**: in "code" metti solo il codice del turno ("M", "P"), e metti "handCorrected": true. Nel reparto un orario a penna vuol dire che quel turno comincia a un orario diverso dal solito, e chi legge la tabella deve poterlo rivedere: il codice sbagliato lo manderebbe sul calendario come se fosse un turno nuovo.
5. La "confidence" è quanto sei sicuro di quella cella, da 0 a 1. Usa **valori bassi quando non sei sicuro**: è molto meglio una confidenza bassa che un codice inventato. Non inventare mai il contenuto di una cella illeggibile — riportala con "code": "" e confidenza bassa.

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
