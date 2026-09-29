# Timer facoltativo delle attivita - v1

## Uso

Il timer e un pannello aggiuntivo nella sezione inserimento ore, disponibile su PC e mobile anche al ruolo User. Non parte automaticamente al login e non modifica il flusso di inserimento manuale.

1. Scegli Cantiere, Viaggio o Ufficio; cliente facoltativo.
2. Premi Avvia timer.
3. Premi Ferma e crea attivita: il tempo viene salvato automaticamente come attivita con needs_details=true.
4. Completa cliente, tipo, macro area e descrizione subito o in seguito. Un User puo completare le proprie bozze timer, senza acquisire diritti di modifica generali. L'amministratore puo completare tutte le bozze timer.

## Durata e persistenza

- La durata deriva da timestamp di inizio/fine, non dai tick del display.
- I secondi interi sono conservati in duration_seconds; hours ha sei decimali. Nessun arrotondamento automatico al quarto d'ora e nessuna pausa dedotta.
- Data di rendicontazione: giorno di inizio nel fuso Europe/Rome. Un intervallo oltre mezzanotte rimane una singola attivita attribuita alla data iniziale.
- Un timer attivo per account e browser. Le schede dello stesso browser usano Web Locks quando disponibili; il timer in corso non e condiviso tra dispositivi diversi.
- Inizio e stop sono conservati in localStorage in una chiave distinta per utente. Al ritorno nella stessa pagina/browser il conteggio si ricostruisce dall'ora iniziale.
- Fermare il timer scrive la coda locale prima di tentare l'invio. Per sincronizzare una coda occorre la pagina aperta, connessione disponibile e sessione dello stesso account.
- Non e una PWA installabile: riaprire da zero l'interfaccia mentre si e completamente offline non e garantito. Non cancellare i dati del browser mentre esistono timer/coda locali; evitare navigazione privata.
- Retry e doppio stop non creano duplicati: la chiave server e timer_<UUID> e la RPC e idempotente.
- Cambio account durante l'invio: p_expected_user viene verificato rispetto all'utente della sessione sul server.
- Il timer mostra un richiamo oltre 12 ore. Date non valide o intervalli oltre 31 giorni vengono rifiutati; la coda locale non viene eliminata.

## Schema

Migrazione: supabase/20260929_optional_activity_timer.sql.
Nuovi campi entries: entry_source, timer_started_at, timer_stopped_at, duration_seconds, needs_details.
RPC: gon_save_timer e gon_complete_timer, disponibili solo ad authenticated. Le funzioni verificano identita, dominio GON, proprietario e campi consentiti. Nessuna password o chiave amministrativa e presente nel modulo.

La migrazione e stata applicata al progetto esistente. Le policy delle attivita manuali non sono state sostituite. Il cambio di precisione hours conserva i valori preesistenti.

## Build

Il build esistente resta invariato salvo la chiamata finale install_timer(OUT), definita in timer_integration.py. Il modulo aggiuntivo e versionato in assets/activity-timer.js e copiato in public/assets. Viene pubblicato timer-build.json con commit, versione e hash dell'asset.

La build fallisce se non trova i marcatori necessari nel sorgente di base. Quando Node e disponibile, verifica sia il modulo sia gli script inline effettivamente generati per PC/mobile. Il sorgente di base resta temporaneamente scaricato da Supabase Storage, come prima di questo intervento.

E stata inoltre corretta la referenza del proprietario negli inserimenti manuali da user.id a currentUser.id: il precedente enter() con ruoli inizializza currentUser.

## Verifiche eseguite durante lo sviluppo

Browser Chromium, DOM reale con autenticazione/database/localStorage simulati (la navigazione di rete del browser di test non era disponibile):
- timer inattivo senza inserimenti automatici;
- indipendenza del form manuale;
- avvio senza inserimento immediato;
- ripristino del timestamp dopo ricreazione pagina con memoria conservata;
- stop automatico e doppio clic;
- completamento differito senza alterare la durata;
- stop offline e successiva sincronizzazione;
- risposta server persa e retry senza duplicato;
- isolamento tra account;
- errore di scrittura locale senza perdita del timer;
- nessun errore JavaScript non gestito negli scenari eseguiti.

Database Supabase reale, transazione di test conclusa con ROLLBACK:
- creazione intervallo di un'ora e retry idempotente;
- precisione positiva per timer di un secondo;
- completamento della propria bozza da parte di User;
- blocco UPDATE diretto per User;
- blocco di identita sessione diversa da p_expected_user;
- RLS: User non legge ne completa timer altrui;
- nessun record di test conservato.

Queste verifiche non equivalgono a un accesso end-to-end sul telefono dell'utente. Serve una prova reale Avvia -> Ferma -> Completa dettagli dopo la pubblicazione.
