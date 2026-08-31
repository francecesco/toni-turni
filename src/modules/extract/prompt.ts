const MAX_PREVIOUS_OUTPUT = 4000

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
