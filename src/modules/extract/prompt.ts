const MAX_PREVIOUS_OUTPUT = 4000

/**
 * Prompt in italiano: la tabella, i nomi e i codici sono italiani, e chiedere al
 * modello di ragionare nella stessa lingua dell immagine riduce le ambiguità.
 */
export function buildExtractionPrompt(knownCodes: string[]): string {
  const elencoCodici =
    knownCodes.length > 0
      ? knownCodes.map((code) => `"${code}"`).join(', ')
      : '(nessun codice noto: riporta esattamente quello che leggi)'

  return `Leggi la fotografia di una tabella turni infermieristica e restituisci **esclusivamente JSON**, senza testo prima o dopo.

La tabella è organizzata così:
- in alto ci sono il reparto (per esempio "3°PIANO"), il mese e l anno;
- ogni **riga** è un giorno del mese, indicato dal numero e dal giorno della settimana abbreviato (lun, mar, mer, gio, ven, sab, dom);
- ogni **colonna** è una persona, con il nome in maiuscolo nell intestazione;
- ogni **cella** contiene il codice del turno che quella persona fa in quel giorno.

Codici turno che il reparto usa: ${elencoCodici}. Se leggi qualcosa che non è in questo elenco, riportalo comunque come lo vedi: non sostituirlo con il codice più somigliante.

Regole importanti:
1. **Ignora** le colonne di aiuto ("AIUTO MATT.", "AIUTO POM.") e le colonne dei totali ("TOT M", "TOT P"): non sono turni di una persona della tabella.
2. Se una cella è **vuota**, restituisci "code": "".
3. Se una cella è stata **corretta a penna**, coperta con il correttore e riscritta, o comunque modificata a mano, metti "handCorrected": true. È l informazione più preziosa che puoi darmi: quelle celle verranno rilette da una persona.
4. La "confidence" è quanto sei sicuro di quella cella, da 0 a 1. Usa **valori bassi quando non sei sicuro**: è molto meglio una confidenza bassa che un codice inventato. Non inventare mai il contenuto di una cella illeggibile.
5. Restituisci una cella per **ogni** incrocio giorno/persona che riesci a leggere, anche quando il codice si ripete.

Formato JSON richiesto:
{
  "year": 2026,
  "month": 8,
  "ward": "3°PIANO",
  "columns": ["RENATA", "KHADIJA"],
  "cells": [
    { "day": 1, "column": "RENATA", "code": "M", "confidence": 0.97, "handCorrected": false },
    { "day": 1, "column": "KHADIJA", "code": "F", "confidence": 0.55, "handCorrected": true }
  ]
}

Ogni valore di "column" dentro "cells" deve comparire in "columns".`
}

export function buildRepairPrompt(previousOutput: string, validationError: string): string {
  const troncato =
    previousOutput.length > MAX_PREVIOUS_OUTPUT
      ? `${previousOutput.slice(0, MAX_PREVIOUS_OUTPUT)}\n[...troncato...]`
      : previousOutput

  return `La risposta precedente non rispetta il formato richiesto.

Errore di validazione: ${validationError}

Risposta precedente:
${troncato}

Correggila e restituisci **esclusivamente** il JSON valido, senza testo prima o dopo e senza recinti markdown.`
}
