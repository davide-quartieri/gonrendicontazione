-- Add two categories, without changing data, roles, ownership or grants.
DO $migration$
DECLARE
  target regprocedure;
  definition text;
  old_list text := $old$'Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie'$old$;
  new_list text := $new$'Rilievo in campo','Elaborazione rilievo','Assistenza cliente','Attività amministrative','Corso','Varie','Rilievo in campo - PROGRAMMATO','Elaborazione rilievo - PROGRAMMATA'$new$;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'private.gon_update_my_entry(text,uuid,integer,date,text,text,text,text,numeric)'::regprocedure,
    'public.gon_complete_timer(text,text,text,text,text,uuid)'::regprocedure
  ] LOOP
    definition := pg_get_functiondef(target);
    IF position(new_list IN definition) > 0 THEN CONTINUE; END IF;
    IF position(old_list IN definition) = 0 THEN
      RAISE EXCEPTION 'Macroarea whitelist not found in %; aborting without changing permissions', target;
    END IF;
    EXECUTE replace(definition, old_list, new_list);
  END LOOP;
END;
$migration$;
