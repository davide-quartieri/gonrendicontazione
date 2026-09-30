# Cliente, periodo e IVA - verifica del rilascio

Questo documento accompagna il ramo `feature/client-monthly-vat`.

## Ambito concordato
- Rendicontazione per cliente e periodo, senza creare o assegnare commesse.
- Modalita oraria oppure forfait mensile complessivo.
- Condizioni editabili dall'amministrazione, uguali per tutti gli operatori.
- Aliquota IVA editabile, imponibile, IVA e totale distinti nella UI e negli export.
- Nessuna modifica automatica ai rendiconti gia emessi o ai prezzi reali.

## Verifiche prima della pubblicazione
- Completare il modulo documento richiamato da monthly_integration.py.
- Collegare la fase mensile dopo le integrazioni gia esistenti.
- Controllare avvio UI, template, calcoli e compatibilita dei documenti precedenti.
- Controllare che timer mobile, storico personale e permessi restino invariati.
- Pubblicare solo dopo i test e verificare il commit effettivamente live.

La presenza di questo file non indica che il rilascio sia gia completo o online.
