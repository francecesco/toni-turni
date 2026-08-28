/**
 * Coda unica per le operazioni di sync. Serve a due cose: SQLite non gestisce
 * scritture concorrenti, e due sync sovrapposti sullo stesso mese leggerebbero
 * entrambi "evento assente" creando due volte lo stesso turno.
 *
 * Il carico reale è di una tabella al mese: una coda in-process è più che
 * sufficiente, e non introduce dipendenze.
 */
let queue: Promise<unknown> = Promise.resolve()

export function withSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  // `catch` sulla coda, non sul risultato: un errore dell operazione precedente
  // non deve bloccare per sempre quelle successive, ma va comunque propagato a chi
  // l ha lanciata.
  const result = queue.then(operation, operation)
  queue = result.catch(() => undefined)
  return result
}
