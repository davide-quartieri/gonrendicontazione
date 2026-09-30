-- Billing grouping only. Do not rewrite activities, rates or issued documents.
CREATE TABLE private.gon_billing_groups (billing_client_id text PRIMARY KEY REFERENCES public.clients(id) ON DELETE RESTRICT,name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 180));
CREATE TABLE private.gon_billing_members (site_client_id text PRIMARY KEY REFERENCES public.clients(id) ON DELETE RESTRICT,billing_client_id text NOT NULL REFERENCES private.gon_billing_groups(billing_client_id) ON DELETE RESTRICT);
CREATE INDEX gon_billing_members_group_idx ON private.gon_billing_members(billing_client_id);
REVOKE ALL ON private.gon_billing_groups,private.gon_billing_members FROM PUBLIC,anon,authenticated;
DO $$ DECLARE root_id text;child_id text; BEGIN
 IF (SELECT count(*) FROM public.clients WHERE main='Gedit' AND site IN ('Vighizzolo','Calcinato'))<>2 THEN RAISE EXCEPTION 'Gedit sites must be reviewed before consolidation'; END IF;
 SELECT id INTO STRICT root_id FROM public.clients WHERE main='Gedit' AND site='Vighizzolo';
 SELECT id INTO STRICT child_id FROM public.clients WHERE main='Gedit' AND site='Calcinato';
 -- The Vighizzolo scope owns the existing agreement and reports. Do not merge two active agreements silently.
 IF EXISTS(SELECT 1 FROM public.gon_projects p WHERE p.client_id=child_id AND (EXISTS(SELECT 1 FROM private.gon_terms t WHERE t.project_id=p.id) OR EXISTS(SELECT 1 FROM private.gon_reports r WHERE r.project_id=p.id))) OR EXISTS(SELECT 1 FROM private.gon_client_billing_accounts WHERE client_id=child_id) THEN RAISE EXCEPTION 'Review Calcinato agreements/reports before consolidating'; END IF;
 INSERT INTO private.gon_billing_groups VALUES(root_id,'Gedit');
 INSERT INTO private.gon_billing_members VALUES(root_id,root_id),(child_id,root_id);
END $$;
CREATE FUNCTION private.gon_billing_client_id(cid text) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$ SELECT coalesce((SELECT billing_client_id FROM private.gon_billing_members WHERE site_client_id=cid),cid); $$;
CREATE FUNCTION private.gon_billing_contains(cid text,site_label text) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.clients c WHERE c.display=site_label AND private.gon_billing_client_id(c.id)=private.gon_billing_client_id(cid)); $$;
CREATE FUNCTION private.gon_billing_client_info(cid text) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT to_jsonb(c)||jsonb_build_object('name',coalesce(g.name,c.main),'main',coalesce(g.name,c.main),'display',coalesce(g.name,c.display),'billing_grouped',g.billing_client_id IS NOT NULL,'site',CASE WHEN g.billing_client_id IS NULL THEN c.site ELSE (SELECT string_agg(s.site,' / ' ORDER BY s.site) FROM public.clients s WHERE private.gon_billing_client_id(s.id)=c.id) END,'sites',(SELECT jsonb_agg(jsonb_build_object('client_id',s.id,'site',s.site,'display',s.display) ORDER BY s.site,s.id) FROM public.clients s WHERE private.gon_billing_client_id(s.id)=c.id)) FROM public.clients c LEFT JOIN private.gon_billing_groups g ON g.billing_client_id=c.id WHERE c.id=private.gon_billing_client_id(cid);
$$;
REVOKE ALL ON FUNCTION private.gon_billing_client_id(text),private.gon_billing_contains(text,text),private.gon_billing_client_info(text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.gon_billing_customers(p_expected_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE result jsonb; BEGIN
 PERFORM private.gon_commercial_actor(p_expected_user,true);
 SELECT coalesce(jsonb_agg(private.gon_billing_client_info(c.id) ORDER BY coalesce(g.name,c.display),c.id),'[]'::jsonb) INTO result FROM public.clients c LEFT JOIN private.gon_billing_groups g ON g.billing_client_id=c.id WHERE private.gon_billing_client_id(c.id)=c.id;
 RETURN result; END $$;
CREATE FUNCTION public.gon_billing_customers(p_expected_user uuid) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT private.gon_billing_customers(p_expected_user); $$;
REVOKE ALL ON FUNCTION private.gon_billing_customers(uuid),public.gon_billing_customers(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.gon_billing_customers(uuid),public.gon_billing_customers(uuid) TO authenticated;
DO $patch$ DECLARE p record;def text;occur integer; BEGIN
 FOR p IN SELECT * FROM (VALUES
 ('private.gon_client_scope(text)','BEGIN',E'BEGIN\n cid:=private.gon_billing_client_id(cid);',1),
 ('private.gon_client_billing(text,jsonb,uuid)','pid:=private.gon_client_scope(cid);',E'cid:=private.gon_billing_client_id(cid);\n IF p_action IN(''overview'',''terms_save'',''report_prepare'') THEN pl:=pl||jsonb_build_object(''client_id'',cid); END IF;\n pid:=private.gon_client_scope(cid);',1),
 ('private.gon_client_billing(text,jsonb,uuid)','(SELECT count(*) FROM public.clients WHERE display=c.display)>1','EXISTS(SELECT 1 FROM public.clients all_sites WHERE private.gon_billing_contains(cid,all_sites.display) GROUP BY all_sites.display HAVING count(*)>1)',1),
 ('private.gon_client_billing(text,jsonb,uuid)','''client'',to_jsonb(c)','''client'',private.gon_billing_client_info(cid)',1),
 ('private.gon_client_billing(text,jsonb,uuid)','WHERE client=c.display AND date BETWEEN df AND dt','WHERE private.gon_billing_contains(cid,client) AND date BETWEEN df AND dt',1),
 ('private.gon_client_billing(text,jsonb,uuid)','WHERE e.client=c.display AND e.date BETWEEN df AND dt','WHERE private.gon_billing_contains(cid,e.client) AND e.date BETWEEN df AND dt',1),
 ('private.gon_client_billing(text,jsonb,uuid)','WHERE p.client_id=cid','WHERE private.gon_billing_client_id(p.client_id)=cid',3),
 ('private.gon_client_report_build(uuid,date,date,jsonb,jsonb,uuid)','e.client IS DISTINCT FROM c.display','NOT private.gon_billing_contains(c.id,e.client)',1),
 ('private.gon_client_report_build(uuid,date,date,jsonb,jsonb,uuid)','jsonb_build_object(''ref'',idx)','jsonb_build_object(''ref'',idx,''site'',(SELECT s.site FROM public.clients s WHERE s.display=e.client))',1),
 ('private.gon_client_report_build(uuid,date,date,jsonb,jsonb,uuid)','jsonb_build_object(''id'',c.id,''name'',c.main,''site'',c.site,''display'',c.display)','private.gon_billing_client_info(c.id)',1),
 ('private.gon_commercial(text,jsonb,uuid)','THEN e.client IS DISTINCT FROM d->''client''->>''display'' ELSE','THEN CASE WHEN d->''client''->>''billing_grouped''=''true'' THEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->''client''->''sites'') bs WHERE bs->>''display''=e.client) ELSE e.client IS DISTINCT FROM d->''client''->>''display'' END ELSE',1)
 )AS v(signature,old,new,expected) LOOP
 def:=pg_get_functiondef(p.signature::regprocedure);occur:=(length(def)-length(replace(def,p.old,'')))/length(p.old);
 IF occur<>p.expected THEN RAISE EXCEPTION 'Billing group marker mismatch: % expected %, got %: %',p.signature,p.expected,occur,p.old;END IF;
 EXECUTE replace(def,p.old,p.new);
 END LOOP;
END $patch$;
