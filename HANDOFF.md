# GON Rendicontazione — Handoff tecnico

Ultimo aggiornamento: 29/09/2026

## 1. Obiettivo del progetto

Applicazione web interna GON per la rendicontazione delle attività di Topography/Engineering, utilizzabile da PC e smartphone e con database condiviso via Internet.

Funzioni principali previste:
- inserimento ore per data/dipendente/cliente;
- distinzione tra ore **Cantiere**, **Viaggio** e **Ufficio**;
- classificazione per macro-area;
- descrizione attività;
- gestione clienti;
- report/export lato PC;
- versione mobile semplificata per inserimento rapido;
- autenticazione utenti GON;
- sincronizzazione PC/mobile sullo stesso database.

## 2. Architettura attuale

```text
PC / Smartphone
      |
      v
Render Static Site
      |
      v
Supabase Auth + PostgreSQL
```

Frontend e backend sono separati:
- **Render** serve le pagine HTML;
- **Supabase** gestisce autenticazione e database;
- **GitHub** contiene il repository usato da Render per il deploy.

## 3. URL attivi

Sito principale consigliato:
- https://gon-rendicontazione-live.onrender.com

Versione PC:
- https://gon-rendicontazione-live.onrender.com/pc.html

Versione mobile:
- https://gon-rendicontazione-live.onrender.com/mobile.html

Esistono deployment Render precedenti di test; quello da considerare attuale è `gon-rendicontazione-live`.

## 4. GitHub

Repository:
- `davide-quartieri/gonrendicontazione`
- branch principale: `main`

File attuali principali:
- `index.html` — pagina iniziale;
- `pc.html` — loader/interfaccia PC;
- `mobile.html` — loader/interfaccia mobile;
- `build.py` — build Render e patch applicative;
- `HANDOFF.md` — questo documento.

## 5. Supabase

Progetto:
- nome: **GON Rendicontazione**
- project ref: `sdlvcpxxgsmvoailtbtz`
- region: `eu-central-1` (Frankfurt)
- project URL: `https://sdlvcpxxgsmvoailtbtz.supabase.co`

Tabelle principali:

### `clients`
Campi principali:
- `id`
- `main`
- `site`
- `display`
- `active`
- `created_by`
- `created_at`

### `entries`
Campi principali:
- `id`
- `date`
- `employee`
- `client`
- `type`
- `macro`
- `description`
- `hours`
- `created_by`
- `created_at`

`type` accetta:
- `Cantiere`
- `Viaggio`
- `Ufficio`

RLS è attivo sulle tabelle.

## 6. Autenticazione

L'app usa Supabase Auth con email/password.

Configurazione funzionale prevista:
- utenti con indirizzo aziendale GON;
- sessione persistente nel browser;
- pulsanti `Accedi` e `Crea accesso GON`;
- possibilità di ricordare l'accesso sul dispositivo.

### Ricorda accesso

Nel build attuale viene aggiunto un flag:

`Ricorda accesso su questo dispositivo`

Comportamento:
- l'email viene memorizzata in `localStorage`;
- la sessione Supabase è persistente;
- quando supportato, la password viene affidata alla Credential Management API / password manager del browser;
- la password **non viene volutamente salvata in chiaro nel localStorage dell'app**.

## 7. Correzione login già applicata

È stato individuato un conflitto JavaScript importante nel sorgente originario.

Il codice usava una costante chiamata:

```js
URL
```

Questa poteva interferire con l'oggetto nativo `window.URL` usato internamente dal browser/Supabase.

Durante la build viene quindi trasformato in:

```js
SUPABASE_URL
```

e la creazione del client usa:

```js
supabase.createClient(SUPABASE_URL, KEY, ...)
```

Questa patch è eseguita automaticamente da `build.py`.

## 8. Come funziona il deploy attuale

Render esegue:

```bash
python build.py
```

`build.py`:
1. crea la cartella `public`;
2. scarica `pc.html` e `mobile.html` dalla sorgente attualmente conservata in Supabase Storage;
3. applica la patch `URL -> SUPABASE_URL`;
4. aggiunge il flag `Ricorda accesso`;
5. aggiunge attributi `name`/`autocomplete` ai campi di login;
6. pubblica i file finali in `public/`;
7. copia `index.html`.

Render pubblica la cartella:

```text
public/
```

## 9. Nota importante: debito tecnico da eliminare

L'architettura attuale funziona come soluzione di transizione, ma il sorgente completo dell'app PC/mobile **non dovrebbe rimanere dipendente da Supabase Storage**.

Passo consigliato appena l'app è stabile:
- portare il sorgente HTML/JS completo direttamente nel repository GitHub;
- eliminare il download da Supabase Storage durante la build;
- mantenere Supabase solo per Auth e database;
- usare GitHub come unica sorgente del codice frontend.

Questo renderà versionamento, rollback e sviluppo molto più semplici.

## 10. Versione PC e mobile

### PC
Deve mantenere tutte le funzioni principali:
- inserimento ore;
- registro attività;
- gestione clienti;
- report/export;
- eventuali strumenti dedicati all'amministrazione.

### Mobile
Deve essere più semplice e veloce:
- login;
- inserimento attività;
- selezione cliente;
- tipo ore;
- macro-area;
- descrizione;
- ore;
- ultime attività/statistiche essenziali.

Non deve contenere tutte le sezioni amministrative della versione PC.

## 11. Funzione Luigi / foglio settimanale

Nel progetto precedente era presente una sezione dedicata al foglio Luigi/OCR per interpretare un riepilogo settimanale scritto a mano.

Sono stati definiti anche format cartacei semplificati con:
- 7 righe, una per giorno della settimana;
- righe alte per scrittura manuale;
- distinzione tra attività e ore.

Questa funzione non è prioritaria per la versione mobile attuale, ma può essere reintegrata nella versione PC.

## 12. Priorità di sviluppo successive

Ordine consigliato:

1. testare completamente login e creazione account su PC;
2. verificare accesso con lo stesso utente da smartphone;
3. creare un cliente reale di prova;
4. inserire un'attività da PC;
5. verificarla da mobile;
6. inserire un'attività da mobile;
7. verificarla da PC;
8. testare logout/login e `Ricorda accesso`;
9. migliorare messaggi di errore e feedback utente;
10. spostare il sorgente completo da Supabase Storage a GitHub;
11. consolidare UI PC/mobile;
12. aggiungere backup/export e gestione ruoli utenti.

## 13. Sicurezza

Non inserire mai nel frontend:
- Supabase secret key;
- service-role key;
- token GitHub;
- credenziali Render;
- password utenti.

Nel browser deve essere usata soltanto la **publishable key Supabase**, con RLS correttamente configurato.

## 14. Indicazioni per un altro account ChatGPT

Per continuare lo sviluppo da un altro account ChatGPT:

1. aprire la chat condivisa del progetto per recuperare il contesto;
2. collegare il plugin GitHub con accesso a `davide-quartieri/gonrendicontazione`;
3. collegare Supabase con accesso al progetto `GON Rendicontazione`;
4. collegare Render con accesso al workspace `GON srl`;
5. leggere questo `HANDOFF.md` prima di modificare l'architettura;
6. verificare lo stato live prima di effettuare cambiamenti.

Prompt suggerito al nuovo account:

> Continua lo sviluppo di GON Rendicontazione. Prima leggi `HANDOFF.md` nel repository `davide-quartieri/gonrendicontazione`, poi controlla lo stato del deploy Render `gon-rendicontazione-live` e del progetto Supabase `GON Rendicontazione`. Mantieni frontend su Render e backend/auth su Supabase.
