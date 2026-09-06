import { describe, expect, it } from 'vitest'
import { buildBandPrompt } from '@/modules/extract/band-prompt'

const CODICI = ['M', 'P', 'NOTTE', 'M1°P', 'RP']

describe('buildBandPrompt', () => {
  const prompt = buildBandPrompt(CODICI, { dayFrom: 17, dayTo: 31, columnCount: 2 })

  it('elenca i codici noti, così il modello non li inventa', () => {
    for (const code of CODICI) expect(prompt).toContain(code)
  })

  it('dice l intervallo di giorni della banda', () => {
    expect(prompt).toContain('17')
    expect(prompt).toContain('31')
    expect(prompt).toMatch(/dal giorno 17 al giorno 31/i)
  })

  it('dice quante colonne di persona aspettarsi', () => {
    expect(prompt).toMatch(/\b2\b/)
    expect(prompt).toMatch(/colonn/i)
  })

  it('dice che un orario scritto a penna accanto al codice non fa parte del codice', () => {
    // Regola del reparto, scritta nelle fixture: `M 7`, `P 13`, `h 13:30` sono
    // annotazioni d orario aggiunte a penna sopra un codice stampato, e il codice
    // resta `M` / `P`. Senza dirlo, il modello le incorpora — misurato: cinque
    // celle su agosto lette come "M7", "P1330", "M730".
    expect(prompt).toMatch(/orario/i)
    expect(prompt).toMatch(/non fa parte del codice|non e parte del codice/i)
    expect(prompt).toMatch(/handCorrected/)
  })

  it('dice che evidenziatore e colore di fondo non sono correzioni a mano', () => {
    // Misurato sulla tabella di settembre letta dall app: 47 celle su 240 marcate
    // handCorrected e nessuna riscritta a penna — le righe delle domeniche
    // evidenziate in giallo e i singoli RP evidenziati col pennarello. Il prompt
    // diceva cosa e una correzione, non cosa non lo e.
    expect(prompt).toMatch(/evidenziat/i)
    expect(prompt).toMatch(/non (e |è )una correzione/i)
    expect(prompt).toMatch(/fondo/i)
  })

  it('chiede esplicitamente di riportare anche le righe vuote', () => {
    expect(prompt).toMatch(/vuot/i)
    expect(prompt).toMatch(/anche[^\n]*vuot/i)
  })

  it('dice di leggere il giorno dalla striscia a sinistra', () => {
    expect(prompt).toMatch(/sinistra/i)
  })

  it('chiede i nomi delle colonne come sono scritti nell intestazione', () => {
    expect(prompt).toMatch(/intestazione/i)
  })

  it('descrive solo i campi che lo schema della banda pretende', () => {
    for (const field of ['columns', 'cells', 'day', 'column', 'code', 'confidence', 'handCorrected']) {
      expect(prompt).toContain(field)
    }
    // year, month e ward non si vedono in una banda: chiederli invita a inventarli
    expect(prompt).not.toContain('"year"')
    expect(prompt).not.toContain('"month"')
    expect(prompt).not.toContain('"ward"')
  })

  it('chiede esclusivamente JSON', () => {
    expect(prompt).toMatch(/solo JSON|soltanto JSON|esclusivamente JSON/i)
  })

  it('chiede di segnalare le correzioni a penna', () => {
    expect(prompt).toMatch(/penna|correttore|corretta a mano/i)
  })

  it('dice di riportare un codice sconosciuto come è scritto, invece di sostituirlo', () => {
    expect(prompt).toMatch(/non.*sostituirlo|riportalo comunque/i)
  })

  it('dice di non inventare il contenuto di una cella illeggibile', () => {
    expect(prompt).toMatch(/non inventare|illeggibil/i)
  })

  it('funziona anche senza codici noti', () => {
    expect(() => buildBandPrompt([], { dayFrom: 1, dayTo: 16, columnCount: 3 })).not.toThrow()
    expect(buildBandPrompt([], { dayFrom: 1, dayTo: 16, columnCount: 3 })).toContain('cells')
  })

  it('non parla di colonne di aiuto da ignorare: nella banda vanno lette e scartate a valle', () => {
    // se il modello salta una colonna la banda slitta, e lo scarto per nome in
    // fase di fusione non ha più niente su cui agganciarsi
    expect(prompt).not.toMatch(/ignora/i)
  })
})

/**
 * Il prompt della **tabella intera**: la stessa funzione, perche la tabella
 * intera e una banda che tiene tutto. Cambia quello che cambia davvero
 * nell immagine, non il modo di parlarne.
 */
describe('buildBandPrompt, tabella intera', () => {
  const prompt = buildBandPrompt(CODICI, {
    dayFrom: 1,
    dayTo: 30,
    columnCount: 13,
    wholeTable: true,
  })

  it('non la chiama ritaglio, perche non lo e', () => {
    expect(prompt).not.toMatch(/ritaglio/i)
    expect(prompt).toMatch(/tabella/i)
  })

  it('avverte della riga del foglio sopra i nomi, che una banda non mostrava mai', () => {
    // Nell immagine intera compare `Piano: 3°PIANO  MESE SETTEMBRE  2026` sopra
    // la riga dei nomi: contata come intestazione, sposta di una riga tutta la
    // lettura.
    expect(prompt).toMatch(/mese/i)
    expect(prompt).toMatch(/non (e |è )?(una )?(riga di )?colonn/i)
  })

  it('avverte che la casella sopra la striscia dei giorni non e una colonna', () => {
    // Misurato: il modello elenca `["3°PIANO", "", "RENATA", ...]`. Il codice lo
    // tollera, ma conviene che non lo produca: la casella in cima alla striscia
    // dei giorni sul foglio e vuota o porta il nome del reparto.
    expect(prompt).toMatch(/sopra la striscia dei giorni/i)
    expect(prompt).toMatch(/non elencarla|non e una colonna|non è una colonna/i)
  })

  it('chiede un ordine di scansione: giorno per giorno, dal primo all ultimo', () => {
    // Su 31 righe il modo in cui il modello sbagliava era perdere il passo fra
    // le righe. Un ordine dichiarato gli da un invariante da tenere.
    expect(prompt).toMatch(/ordine/i)
    expect(prompt).toMatch(/giorno 1[^\n]*giorno 30|dal giorno 1 al giorno 30/i)
  })

  it('dice quante celle aspettarsi in tutto', () => {
    expect(prompt).toContain('390') // 30 giorni x 13 colonne
  })

  it('continua a dire di leggere il giorno dalla striscia e di riportare le vuote', () => {
    expect(prompt).toMatch(/sinistra/i)
    expect(prompt).toMatch(/anche[^\n]*vuot/i)
  })

  it('non chiede year, month e ward: li conosce chi ha caricato la foto', () => {
    // Sono visibili nell immagine intera, al contrario che in una banda: proprio
    // per questo va detto di non riportarli, o il modello li aggiunge allo schema.
    expect(prompt).not.toContain('"year"')
    expect(prompt).not.toContain('"ward"')
  })
})
