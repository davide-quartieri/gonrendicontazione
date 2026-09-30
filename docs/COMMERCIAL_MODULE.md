# Commesse e rendiconti economici — prima versione

Versione applicativa: commercial-1.0.0. Frontend PC amministratore; assegnazione operativa commesse su PC e mobile.

## Avvio operativo

1. Accedere con l'account amministratore e aprire **Commesse e rendiconti**.
2. Creare una commessa: cliente/cantiere esistente, codice univoco, descrizione, riferimento offerta/ordine, stato attivo.
3. Aprire **Condizioni economiche**. Inserire la decorrenza dell'accordo, non necessariamente la data odierna. Compilare soltanto le tariffe concordate. Un campo vuoto significa **Da definire**, non zero.
4. Caricare il periodo. Le attività del cliente senza commessa sono mostrate e possono essere assegnate in blocco. Non vengono attribuite commesse automaticamente alle registrazioni storiche.
5. Selezionare attività complete e assegnate. **Prepara bozza** crea una copia delle attività e delle condizioni applicabili alle loro date.
6. Inserire sintesi, recapiti, elaborati, note per il cliente. Verificare quantità, tariffe, spese e sconto. **Salva e ricalcola importi** usa i calcoli decimali del database.
7. **Approva ed emetti** assegna il numero RC-AAAA-NNNN e blocca la copia. Il cliente non riceve alcuna email automatica.
8. **Anteprima / Stampa PDF** apre il documento: usare Stampa / Salva PDF nel browser. **Scarica copia documento** produce un HTML autonomo. **Excel economico** produce una copia di lavoro a tre fogli.
9. Dopo aver spedito manualmente il documento, **Registra invio effettuato** memorizza destinatario e data; non spedisce messaggi.

L'export Excel interno con dashboard, logo e grafici resta separato e invariato.

## Tariffe

- Stesse condizioni per tutti i dipendenti della commessa.
- Otto macroaree e tre tipi ore: 24 combinazioni configurabili.
- A ore: somma delle quantità approvate; eventuale arrotondamento per ciascuna registrazione (nessuno, per eccesso, al più vicino; 5/10/15/30/60 minuti).
- Forfait unico: una quota per commessa + macroarea + tipo ore. Le ore sottostanti restano informative e non vengono riaddebitate.
- Canone mensile: una quota per mese contenente attività selezionate, per macroarea + tipo ore. Non vengono generati automaticamente canoni per mesi privi di attività; nessun prorata automatico.
- Quantità diverse concordate sono rettificabili nella bozza con motivazione. Ulteriori prestazioni della medesima quota già emessa richiedono una revisione, non un nuovo addebito identico.
- Non esiste un listino cliente ereditato implicitamente: ogni commessa ha le proprie condizioni. Non sono state inserite tariffe reali o dimostrative nell'archivio.

Salvare condizioni crea una nuova versione. Una decorrenza successiva chiude la precedente validità; la stessa decorrenza sostituisce la versione attiva conservando la precedente. Non sono ammesse decorrenze anteriori all'ultima versione: per eccezioni storiche usare la rettifica del rendiconto, senza riscrivere il listino.

Le bozze non vengono ricalcolate silenziosamente. **Aggiorna da attività e listino** è esplicito, richiede conferma e azzera le rettifiche alle righe, conservando sconto, spese e intestazione già salvati.

## Documenti e quantità

Il documento cliente riprende le tre sezioni del modello economico v2: sintesi e distribuzione ore; attività/elaborati; quadro economico.

Le ore della sintesi sono le ore operative selezionate. Quantità e corrispettivi approvati sono distinti e indicati nel quadro economico. La valorizzazione non modifica le registrazioni operative o gli orari originali del timer.

La bozza permette di modificare descrizioni delle prestazioni economiche, quantità e prezzi, spese, sconto sulle sole prestazioni e intestazione. Le modifiche di quantità/prezzo richiedono un motivo interno; i motivi interni non sono stampati per il cliente.

Quantità normalizzate a 6 decimali, tariffe a 4, importi di riga a 2. Sconto calcolato sul subtotale delle prestazioni; spese non scontate. EUR. IVA e altri oneri non calcolati. Non è una fattura.

## Sicurezza e integrità

- `public.gon_projects` contiene soltanto dati operativi non economici ed è leggibile dagli utenti GON autenticati. Scritture soltanto tramite API amministrativa.
- `entries.project_id` è nullable. Un trigger verifica l'appartenenza al cliente e annulla l'associazione quando cambia il cliente.
- `gon_assign_projects` permette all'utente di assegnare soltanto le proprie attività, agli amministratori quelle di tutti. Versione della registrazione obbligatoria; nessuna estensione generale dei permessi UPDATE.
- Tariffe, documenti, contatori, associazioni di fatturazione e audit sono nello schema `private`, con RLS e accesso diretto revocato ad anon/authenticated.
- `gon_commercial` controlla utente attuale, dominio aziendale, profilo e ruolo amministratore sul server, per ogni operazione. La UI non è il confine di sicurezza.
- Le condizioni economiche e i documenti non vengono salvati nel localStorage del browser. Il DOM economico viene ripulito al cambio account.
- Le bozze usano controllo versione e le operazioni commerciali sono serializzate per commessa.
- L'emissione verifica che le attività non siano cambiate dopo la bozza e blocca tariffe mancanti o doppia rendicontazione.
- La copia JSON emessa conserva attività, intestazione, logo, tariffe, importi e numero. Modifiche successive ai dati operativi sono segnalate senza alterare la copia emessa.
- La revisione conserva il numero e incrementa l'indice. Al momento della sua emissione, la versione precedente diventa sostituita e i vincoli anti-doppio-addebito passano alla nuova.

## Limiti dichiarati della prima versione

- La copia economica nel database è uno snapshot strutturato. I file PDF non sono archiviati automaticamente su Storage: vengono creati e salvati tramite la stampa del browser. L'HTML scaricato conserva una copia autonoma del documento impaginato.
- L'Excel economico è una copia di lavoro con formule, distinta dall'Excel interno grafico già presente. La modifica di un file scaricato non aggiorna il database.
- Nessun invio email, integrazione contabile, fatturazione elettronica o calcolo fiscale automatico.
- Nessun listino per dipendente/qualifica, nessuna eredità implicita da altri clienti/commesse.
- Panoramica: fino a 5.000 attività del periodo; bozza: fino a 1.500 attività; assegnazione in blocco: fino a 500; archivio visualizzato: ultimi 100 documenti della commessa. Oltre tali limiti restringere il periodo.
- L'anagrafica clienti/cantieri esistente viene riutilizzata. Non vengono unificati automaticamente clienti con nomi simili.

## Build e sorgenti

`python build.py` esegue la build esistente, `install_timer`, `install_reports` e infine `install_commercial`.

`commercial_integration.py` aggiunge la scelta commessa, il pulsante di assegnazione nello storico e il modulo amministrativo; sostituisce il precedente guard asincrono del form con un guard sincrono del rendering. La bozza non viene ripristinata da una fotografia precedente all'attesa di rete, evitando di cancellare testo digitato durante il caricamento.

La build verifica marker e sintassi; interrompe la pubblicazione su strutture inattese. `commercial-build.json` identifica commit e hash effettivi degli asset finali.

SQL consolidato per un ambiente già dotato del precedente schema GON: prima `20260930_commercial_core.sql`, poi `20260930_commercial_reports.sql`, poi `20260930_commercial_api.sql`. Le migrazioni sono già state applicate al progetto esistente; non rieseguirle alla cieca. I file incorporano le correzioni di alias SQL e normalizzazione dei baseline effettuate durante il collaudo. Lo storico remoto delle migrazioni resta disponibile su Supabase.

## Verifiche effettuate

- Database reale con transazioni e ROLLBACK: creazione commessa/condizioni, decorrenze, arrotondamenti, calcoli, bozza, approvazione, invio registrato, revisione e snapshot invariati.
- Casi negativi: tariffa mancante, rettifica senza motivo, versione concorrente, attività modificata dopo la bozza, doppio forfait/canone, commessa di altro cliente, utente non amministratore, mismatch sessione e accesso anonimo.
- 20 verifiche dell'interfaccia Chromium con API e utenti simulati: flusso operativo, tariffe inizialmente vuote, editor bloccato dopo emissione, pulizia dei dati economici al cambio account, form non azzerato durante richieste asincrone e escaping del documento.
- PDF di tre pagine generato e ispezionato con soli dati dimostrativi.

Queste verifiche non equivalgono al collaudo end-to-end con le credenziali reali sul telefono e nell'installazione Excel dell'amministrazione. Il primo rendiconto reale deve essere controllato prima dell'invio.
