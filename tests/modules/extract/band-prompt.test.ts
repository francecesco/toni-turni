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
