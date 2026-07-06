--
-- Polyphony Database — baseline schema
--
-- Captured 2026-07-06 from the production Heroku Postgres database
-- (app polyphony-database-node) with:
--   pg_dump --schema-only --no-owner --no-privileges --schema=public
--
-- This is the authoritative reference for the application schema. Apply it
-- to an empty database, then run later numbered migrations in order.
-- Requires extensions (installed outside the public schema filter):
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS intarray;

--
-- PostgreSQL database dump
--

-- Dumped from database version 16.13
-- Dumped by pg_dump version 17.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: compute_sorted_clef_combination_all(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_sorted_clef_combination_all(clefs_jsonb jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    result TEXT;
BEGIN
    -- Return NULL if no clefs
    IF clefs_jsonb IS NULL OR jsonb_array_length(clefs_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    -- Extract ALL clefs (required AND optional), sort them, and concatenate
    SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
        CASE clef_obj->>'clef'
            WHEN 'g1' THEN 0 WHEN 'g2' THEN 1 WHEN 'g3' THEN 2 WHEN 'c1' THEN 3
            WHEN 'g4' THEN 4 WHEN 'c2' THEN 5 WHEN 'g5' THEN 6 WHEN 'c3' THEN 7
            WHEN 'f1' THEN 8 WHEN 'g28' THEN 9 WHEN 'c4' THEN 10 WHEN 'f2' THEN 11
            WHEN 'c5' THEN 12 WHEN 'd1' THEN 13 WHEN 'f3' THEN 14 WHEN 'd2' THEN 15
            WHEN 'f4' THEN 16 WHEN 'd3' THEN 17 WHEN 'y1' THEN 18 WHEN 'f5' THEN 19
            WHEN 'd4' THEN 20 WHEN 'y2' THEN 21 WHEN 'd5' THEN 22 WHEN 'y3' THEN 23
            WHEN 'y4' THEN 24 WHEN 'y5' THEN 25 WHEN 'x1' THEN 26 WHEN 'x2' THEN 27
            WHEN 'x3' THEN 28 WHEN 'x4' THEN 29 WHEN 'x5' THEN 30 WHEN 'org' THEN 31
            WHEN 'bc' THEN 32 WHEN 'lut' THEN 33
            ELSE 999
        END
    )
    INTO result
    FROM jsonb_array_elements(clefs_jsonb) AS clef_obj
    WHERE clef_obj->>'clef' IS NOT NULL
    AND clef_obj->>'clef' != '';
    
    RETURN result;
END;
$$;


--
-- Name: compute_sorted_clef_combination_required(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_sorted_clef_combination_required(clefs_jsonb jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    result TEXT;
BEGIN
    -- Return NULL if no clefs
    IF clefs_jsonb IS NULL OR jsonb_array_length(clefs_jsonb) = 0 THEN
        RETURN NULL;
    END IF;
    
    -- Extract NON-OPTIONAL clefs only, sort them, and concatenate
    SELECT string_agg(clef_obj->>'clef', '' ORDER BY 
        CASE clef_obj->>'clef'
            WHEN 'g1' THEN 0 WHEN 'g2' THEN 1 WHEN 'g3' THEN 2 WHEN 'c1' THEN 3
            WHEN 'g4' THEN 4 WHEN 'c2' THEN 5 WHEN 'g5' THEN 6 WHEN 'c3' THEN 7
            WHEN 'f1' THEN 8 WHEN 'g28' THEN 9 WHEN 'c4' THEN 10 WHEN 'f2' THEN 11
            WHEN 'c5' THEN 12 WHEN 'd1' THEN 13 WHEN 'f3' THEN 14 WHEN 'd2' THEN 15
            WHEN 'f4' THEN 16 WHEN 'd3' THEN 17 WHEN 'y1' THEN 18 WHEN 'f5' THEN 19
            WHEN 'd4' THEN 20 WHEN 'y2' THEN 21 WHEN 'd5' THEN 22 WHEN 'y3' THEN 23
            WHEN 'y4' THEN 24 WHEN 'y5' THEN 25 WHEN 'x1' THEN 26 WHEN 'x2' THEN 27
            WHEN 'x3' THEN 28 WHEN 'x4' THEN 29 WHEN 'x5' THEN 30 WHEN 'org' THEN 31
            WHEN 'bc' THEN 32 WHEN 'lut' THEN 33
            ELSE 999
        END
    )
    INTO result
    FROM jsonb_array_elements(clefs_jsonb) AS clef_obj
    WHERE (clef_obj->>'optional')::boolean IS NOT TRUE
    AND clef_obj->>'clef' IS NOT NULL
    AND clef_obj->>'clef' != '';
    
    RETURN result;
END;
$$;


--
-- Name: get_record_title(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_record_title(table_name text, record_data jsonb) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    CASE table_name
        WHEN 'sources' THEN
            RETURN COALESCE(record_data->>'code', record_data->>'siglum', 'Untitled Source');
        WHEN 'groups' THEN
            RETURN COALESCE(record_data->>'display_title', 'Untitled Group');
        WHEN 'compositions' THEN
            RETURN COALESCE(record_data->>'title_text', 'Untitled Composition');
        WHEN 'editions' THEN
            RETURN COALESCE(record_data->>'editor_name', 'Unknown Editor') || ' Edition';
        WHEN 'recordings' THEN
            RETURN COALESCE(record_data->>'performer_name', 'Unknown Performer') || ' Recording';
        WHEN 'composers' THEN
            RETURN COALESCE(record_data->>'name', 'Unknown Composer');
        WHEN 'functions' THEN
            RETURN COALESCE(record_data->>'name', 'Unknown Function');
        WHEN 'titles' THEN
            RETURN COALESCE(record_data->>'text', 'Untitled');
        WHEN 'users' THEN
            RETURN COALESCE(record_data->>'email', 'Unknown User');
        ELSE
            RETURN 'Record #' || COALESCE(record_data->>'id', '?');
    END CASE;
END;
$$;


--
-- Name: FUNCTION get_record_title(table_name text, record_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_record_title(table_name text, record_data jsonb) IS 'Extracts meaningful titles from records for audit display';


--
-- Name: log_audit_entry(integer, character varying, character varying, character varying, integer, jsonb, jsonb, inet, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_audit_entry(p_user_id integer, p_user_email character varying, p_action character varying, p_table_name character varying, p_record_id integer, p_old_data jsonb DEFAULT NULL::jsonb, p_new_data jsonb DEFAULT NULL::jsonb, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    audit_id INTEGER;
    record_title TEXT;
    changes_data JSONB;
BEGIN
    -- Determine record title
    record_title := get_record_title(p_table_name, COALESCE(p_new_data, p_old_data));
    
    -- Build changes data
    changes_data := jsonb_build_object(
        'old', p_old_data,
        'new', p_new_data
    );
    
    -- Insert audit log entry
    INSERT INTO audit_log (
        user_id, user_email, action, table_name, record_id, 
        record_title, changes, ip_address, user_agent, created_at
    )
    VALUES (
        p_user_id, p_user_email, p_action, p_table_name, p_record_id,
        record_title, changes_data, p_ip_address, p_user_agent, CURRENT_TIMESTAMP
    )
    RETURNING id INTO audit_id;
    
    RETURN audit_id;
END;
$$;


--
-- Name: FUNCTION log_audit_entry(p_user_id integer, p_user_email character varying, p_action character varying, p_table_name character varying, p_record_id integer, p_old_data jsonb, p_new_data jsonb, p_ip_address inet, p_user_agent text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.log_audit_entry(p_user_id integer, p_user_email character varying, p_action character varying, p_table_name character varying, p_record_id integer, p_old_data jsonb, p_new_data jsonb, p_ip_address inet, p_user_agent text) IS 'Helper function to create standardized audit log entries';


--
-- Name: refresh_group_analysis_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_group_analysis_cache() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY group_analysis_cache;
END;
$$;


--
-- Name: update_sorted_clef_combinations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_sorted_clef_combinations() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.sorted_clef_combination_required := compute_sorted_clef_combination_required(NEW.clefs);
    NEW.sorted_clef_combination_all := compute_sorted_clef_combination_all(NEW.clefs);
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    user_id integer,
    user_email character varying(255),
    action character varying(50) NOT NULL,
    table_name character varying(100) NOT NULL,
    record_id integer,
    record_title character varying(500),
    changes jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: TABLE audit_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_log IS 'Comprehensive audit trail for all database changes';


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: clef_combinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clef_combinations (
    id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    clef_combination character varying
);


--
-- Name: clef_combinations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clef_combinations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clef_combinations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clef_combinations_id_seq OWNED BY public.clef_combinations.id;


--
-- Name: clef_combinations_voicings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clef_combinations_voicings (
    clef_combination_id integer NOT NULL,
    voicing_id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: composers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.composers (
    id integer NOT NULL,
    name character varying,
    from_year integer,
    to_year integer,
    from_year_annotation character varying,
    to_year_annotation character varying,
    birthplace_1 character varying,
    birthplace_2 character varying,
    deathplace_1 character varying,
    deathplace_2 character varying,
    image_url character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(name, ''::character varying))::text), 'A'::"char")) STORED
);


--
-- Name: composers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.composers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: composers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.composers_id_seq OWNED BY public.composers.id;


--
-- Name: composition_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.composition_types (
    id bigint NOT NULL,
    name character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: composition_types_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.composition_types_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: composition_types_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.composition_types_id_seq OWNED BY public.composition_types.id;


--
-- Name: compositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compositions (
    id integer NOT NULL,
    number_of_voices integer,
    group_id integer,
    title_id integer,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    composition_type_id bigint,
    even_odd integer,
    composer_id_list integer[],
    tone text[],
    tone_connector character varying(3) DEFAULT 'et'::character varying
);


--
-- Name: compositions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.compositions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: compositions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.compositions_id_seq OWNED BY public.compositions.id;


--
-- Name: editions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.editions (
    id integer NOT NULL,
    voicing character varying,
    file_url character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    group_id integer,
    editor_id integer
);


--
-- Name: editions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.editions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: editions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.editions_id_seq OWNED BY public.editions.id;


--
-- Name: editors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.editors (
    id integer NOT NULL,
    name character varying,
    date_of_birth date,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(name, ''::character varying))::text), 'A'::"char")) STORED
);


--
-- Name: editors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.editors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: editors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.editors_id_seq OWNED BY public.editors.id;


--
-- Name: functions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.functions (
    id integer NOT NULL,
    name character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: functions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.functions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: functions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.functions_id_seq OWNED BY public.functions.id;


--
-- Name: functions_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.functions_titles (
    function_id integer NOT NULL,
    title_id integer NOT NULL
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id integer NOT NULL,
    display_title character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: inclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inclusions (
    id integer NOT NULL,
    source_id integer,
    notes character varying,
    "order" integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    "position" character varying,
    composition_id integer,
    clefs jsonb,
    attribution_texts jsonb,
    composer_ids jsonb,
    sorted_clef_combination_required text,
    sorted_clef_combination_all text
);


--
-- Name: TABLE inclusions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.inclusions IS 'Inclusions table with optimized sorted clef combination columns for fast voicing searches';


--
-- Name: COLUMN inclusions."position"; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inclusions."position" IS 'Folio numbers or other position indicators';


--
-- Name: COLUMN inclusions.sorted_clef_combination_required; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inclusions.sorted_clef_combination_required IS 'Computed column containing sorted non-optional clefs only';


--
-- Name: COLUMN inclusions.sorted_clef_combination_all; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inclusions.sorted_clef_combination_all IS 'Computed column containing sorted clefs including optional ones';


--
-- Name: source_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_images (
    id integer NOT NULL,
    url text NOT NULL,
    label text,
    source_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    id integer NOT NULL,
    code character varying NOT NULL,
    title text,
    type character varying,
    format character varying,
    town character varying,
    rism_link character varying,
    catalogued boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    from_year integer,
    to_year integer,
    from_year_annotation character varying,
    to_year_annotation character varying,
    notes character varying
);


--
-- Name: titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.titles (
    id integer NOT NULL,
    text character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    language integer
);


--
-- Name: group_analysis_cache; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.group_analysis_cache AS
 WITH group_data AS (
         SELECT g.id,
            g.display_title,
            ( SELECT mode() WITHIN GROUP (ORDER BY c.number_of_voices) AS mode
                   FROM public.compositions c
                  WHERE ((c.group_id = g.id) AND (c.number_of_voices IS NOT NULL))) AS voice_count,
            ( SELECT array_agg(DISTINCT (i.clefs)::text) FILTER (WHERE ((i.clefs IS NOT NULL) AND (i.clefs <> '[]'::jsonb))) AS array_agg
                   FROM (public.compositions c
                     JOIN public.inclusions i ON ((c.id = i.composition_id)))
                  WHERE (c.group_id = g.id)) AS clef_combinations,
            ( SELECT json_agg(json_build_object('text', t.text, 'language', t.language)) AS json_agg
                   FROM (public.compositions c
                     JOIN public.titles t ON ((c.title_id = t.id)))
                  WHERE ((c.group_id = g.id) AND (t.text IS NOT NULL))) AS title_language_pairs,
            ( SELECT json_agg(composer_data.composer_data) AS json_agg
                   FROM (( SELECT DISTINCT comp.id,
                            comp.name,
                            comp.from_year,
                            comp.to_year
                           FROM (public.compositions c
                             JOIN public.composers comp ON ((comp.id = ANY (c.composer_id_list))))
                          WHERE ((c.group_id = g.id) AND (c.composer_id_list IS NOT NULL))) comp_distinct(id, name, from_year, to_year)
                     CROSS JOIN LATERAL json_build_object('id', comp_distinct.id, 'name', comp_distinct.name, 'from_year', comp_distinct.from_year, 'to_year', comp_distinct.to_year) composer_data(composer_data))) AS composer_details,
            ( SELECT json_agg(json_build_object('id', s_distinct.id, 'code', s_distinct.code, 'title', s_distinct.title, 'location', s_distinct.town, 'from_year', s_distinct.from_year, 'to_year', s_distinct.to_year, 'images', COALESCE(si.images, '[]'::json))) AS json_agg
                   FROM (( SELECT DISTINCT s.id,
                            s.code,
                            s.title,
                            s.town,
                            s.from_year,
                            s.to_year
                           FROM ((public.compositions c
                             JOIN public.inclusions i ON ((c.id = i.composition_id)))
                             JOIN public.sources s ON ((i.source_id = s.id)))
                          WHERE (c.group_id = g.id)) s_distinct
                     LEFT JOIN ( SELECT si2.source_id,
                            json_agg(json_build_object('url', si2.url, 'label', si2.label)) AS images
                           FROM public.source_images si2
                          GROUP BY si2.source_id) si ON ((s_distinct.id = si.source_id)))) AS source_details,
            ( SELECT array_agg(DISTINCT ct.name) FILTER (WHERE (ct.name IS NOT NULL)) AS array_agg
                   FROM (public.compositions c
                     LEFT JOIN public.composition_types ct ON ((c.composition_type_id = ct.id)))
                  WHERE (c.group_id = g.id)) AS composition_types,
            ( SELECT array_agg(DISTINCT (c.tone)::text) FILTER (WHERE (c.tone IS NOT NULL)) AS array_agg
                   FROM public.compositions c
                  WHERE (c.group_id = g.id)) AS composition_tones,
            ( SELECT array_agg(DISTINCT (c.even_odd)::text) FILTER (WHERE (c.even_odd IS NOT NULL)) AS array_agg
                   FROM public.compositions c
                  WHERE (c.group_id = g.id)) AS composition_even_odd,
            (NOT (EXISTS ( SELECT 1
                   FROM (public.compositions c
                     CROSS JOIN LATERAL unnest(COALESCE(c.composer_id_list, ARRAY[]::integer[])) composer_id(composer_id))
                  WHERE ((c.group_id = g.id) AND (c.composer_id_list IS NOT NULL) AND (array_length(c.composer_id_list, 1) > 0) AND (composer_id.composer_id <> 23))))) AS is_anonymous,
            ( SELECT string_agg((i.notes)::text, ' '::text) FILTER (WHERE ((i.notes IS NOT NULL) AND ((i.notes)::text <> ''::text))) AS string_agg
                   FROM (public.compositions c
                     JOIN public.inclusions i ON ((c.id = i.composition_id)))
                  WHERE (c.group_id = g.id)) AS inclusion_notes,
            g.created_at,
            g.updated_at
           FROM public.groups g
          WHERE (EXISTS ( SELECT 1
                   FROM public.compositions c
                  WHERE ((c.group_id = g.id) AND (c.number_of_voices IS NOT NULL))))
        )
 SELECT id,
    display_title,
    voice_count,
    clef_combinations,
    title_language_pairs,
    composer_details,
    source_details,
    composition_types,
    composition_tones,
    composition_even_odd,
    is_anonymous,
    inclusion_notes,
    created_at,
    updated_at
   FROM group_data
  WHERE ((voice_count IS NOT NULL) AND (title_language_pairs IS NOT NULL) AND (composer_details IS NOT NULL))
  WITH NO DATA;


--
-- Name: groups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.groups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: groups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.groups_id_seq OWNED BY public.groups.id;


--
-- Name: ignored_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ignored_alerts (
    id integer NOT NULL,
    alert_type character varying(255) NOT NULL,
    entity_type character varying(255) NOT NULL,
    entity_id integer NOT NULL,
    ignored_by integer,
    ignored_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    reason text
);


--
-- Name: TABLE ignored_alerts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ignored_alerts IS 'Tracks ignored data quality alerts to prevent re-showing';


--
-- Name: ignored_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ignored_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ignored_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ignored_alerts_id_seq OWNED BY public.ignored_alerts.id;


--
-- Name: inclusions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inclusions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inclusions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inclusions_id_seq OWNED BY public.inclusions.id;


--
-- Name: languages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.languages (
    id integer NOT NULL,
    language character varying
);


--
-- Name: performers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.performers (
    id integer NOT NULL,
    name character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(name, ''::character varying))::text), 'A'::"char")) STORED
);


--
-- Name: performers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.performers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: performers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.performers_id_seq OWNED BY public.performers.id;


--
-- Name: publishers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publishers (
    id integer NOT NULL,
    name character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: publishers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.publishers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: publishers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.publishers_id_seq OWNED BY public.publishers.id;


--
-- Name: publishers_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publishers_sources (
    publisher_id integer NOT NULL,
    source_id integer NOT NULL
);


--
-- Name: recordings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recordings (
    id integer NOT NULL,
    file_url character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    unique_piece_id integer,
    group_id integer,
    performer_id integer
);


--
-- Name: recordings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recordings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recordings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recordings_id_seq OWNED BY public.recordings.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: scribes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scribes (
    id integer NOT NULL,
    name character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: scribes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.scribes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: scribes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.scribes_id_seq OWNED BY public.scribes.id;


--
-- Name: scribes_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scribes_sources (
    scribe_id integer NOT NULL,
    source_id integer NOT NULL
);


--
-- Name: source_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.source_images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: source_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.source_images_id_seq OWNED BY public.source_images.id;


--
-- Name: sources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sources_id_seq OWNED BY public.sources.id;


--
-- Name: suggestion_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suggestion_flags (
    id integer NOT NULL,
    group1_id integer,
    group2_id integer,
    flag_type character varying(50) DEFAULT 'not_same'::character varying,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    notes text
);


--
-- Name: suggestion_flags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.suggestion_flags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: suggestion_flags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.suggestion_flags_id_seq OWNED BY public.suggestion_flags.id;


--
-- Name: temp_inclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.temp_inclusions (
    id integer NOT NULL,
    source_id integer,
    "position" integer,
    composition_name text,
    composition_type text,
    composers text,
    clefs text,
    composition_id integer,
    processed boolean DEFAULT false,
    original_composition_id integer,
    tone text,
    even_odd integer,
    composition_type_id integer,
    number_of_voices integer,
    composer_ids_json text
);


--
-- Name: temp_inclusions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.temp_inclusions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: temp_inclusions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.temp_inclusions_id_seq OWNED BY public.temp_inclusions.id;


--
-- Name: title_word_cache; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.title_word_cache AS
 SELECT g.id AS group_id,
    t.id AS title_id,
    t.text AS title_text,
    string_to_array(regexp_replace(lower(regexp_replace((t.text)::text, '[^\w\s]'::text, ''::text, 'g'::text)), '\s+'::text, ' '::text, 'g'::text), ' '::text) AS words,
    array_length(string_to_array(regexp_replace(lower(regexp_replace((t.text)::text, '[^\w\s]'::text, ''::text, 'g'::text)), '\s+'::text, ' '::text, 'g'::text), ' '::text), 1) AS word_count
   FROM ((public.compositions c
     JOIN public.titles t ON ((c.title_id = t.id)))
     JOIN public.groups g ON ((c.group_id = g.id)))
  WHERE ((t.text IS NOT NULL) AND (TRIM(BOTH FROM t.text) <> ''::text))
  WITH NO DATA;


--
-- Name: titles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.titles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: titles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.titles_id_seq OWNED BY public.titles.id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_permissions (
    user_id integer NOT NULL,
    catalogue boolean DEFAULT true NOT NULL,
    booklet_creator boolean DEFAULT false NOT NULL,
    import_source boolean DEFAULT false NOT NULL,
    updated_at timestamp without time zone DEFAULT now(),
    updated_by integer
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    sid character varying NOT NULL,
    sess json NOT NULL,
    expire timestamp(6) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    role character varying(20) DEFAULT 'user'::character varying,
    reset_token character varying(255),
    reset_token_expires timestamp without time zone,
    last_login timestamp without time zone,
    login_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_admin boolean DEFAULT false,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('user'::character varying)::text, ('admin'::character varying)::text]))),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('suspended'::character varying)::text])))
);


--
-- Name: users_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users_backup (
    id integer,
    username character varying,
    password character varying,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: voicing_search_index; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.voicing_search_index AS
 SELECT g.id AS group_id,
    g.display_title,
    array_agg(DISTINCT i.sorted_clef_combination_required) FILTER (WHERE (i.sorted_clef_combination_required IS NOT NULL)) AS clef_combinations_required,
    array_agg(DISTINCT i.sorted_clef_combination_all) FILTER (WHERE (i.sorted_clef_combination_all IS NOT NULL)) AS clef_combinations_all
   FROM ((public.groups g
     LEFT JOIN public.compositions c ON ((g.id = c.group_id)))
     LEFT JOIN public.inclusions i ON ((c.id = i.composition_id)))
  GROUP BY g.id, g.display_title;


--
-- Name: voicings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voicings (
    id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    voicing character varying
);


--
-- Name: voicings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.voicings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: voicings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.voicings_id_seq OWNED BY public.voicings.id;


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: clef_combinations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clef_combinations ALTER COLUMN id SET DEFAULT nextval('public.clef_combinations_id_seq'::regclass);


--
-- Name: composers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composers ALTER COLUMN id SET DEFAULT nextval('public.composers_id_seq'::regclass);


--
-- Name: composition_types id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composition_types ALTER COLUMN id SET DEFAULT nextval('public.composition_types_id_seq'::regclass);


--
-- Name: compositions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compositions ALTER COLUMN id SET DEFAULT nextval('public.compositions_id_seq'::regclass);


--
-- Name: editions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editions ALTER COLUMN id SET DEFAULT nextval('public.editions_id_seq'::regclass);


--
-- Name: editors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editors ALTER COLUMN id SET DEFAULT nextval('public.editors_id_seq'::regclass);


--
-- Name: functions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.functions ALTER COLUMN id SET DEFAULT nextval('public.functions_id_seq'::regclass);


--
-- Name: groups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups ALTER COLUMN id SET DEFAULT nextval('public.groups_id_seq'::regclass);


--
-- Name: ignored_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ignored_alerts ALTER COLUMN id SET DEFAULT nextval('public.ignored_alerts_id_seq'::regclass);


--
-- Name: inclusions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inclusions ALTER COLUMN id SET DEFAULT nextval('public.inclusions_id_seq'::regclass);


--
-- Name: performers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performers ALTER COLUMN id SET DEFAULT nextval('public.performers_id_seq'::regclass);


--
-- Name: publishers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers ALTER COLUMN id SET DEFAULT nextval('public.publishers_id_seq'::regclass);


--
-- Name: recordings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings ALTER COLUMN id SET DEFAULT nextval('public.recordings_id_seq'::regclass);


--
-- Name: scribes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scribes ALTER COLUMN id SET DEFAULT nextval('public.scribes_id_seq'::regclass);


--
-- Name: source_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_images ALTER COLUMN id SET DEFAULT nextval('public.source_images_id_seq'::regclass);


--
-- Name: sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources ALTER COLUMN id SET DEFAULT nextval('public.sources_id_seq'::regclass);


--
-- Name: suggestion_flags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags ALTER COLUMN id SET DEFAULT nextval('public.suggestion_flags_id_seq'::regclass);


--
-- Name: temp_inclusions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temp_inclusions ALTER COLUMN id SET DEFAULT nextval('public.temp_inclusions_id_seq'::regclass);


--
-- Name: titles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.titles ALTER COLUMN id SET DEFAULT nextval('public.titles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: voicings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voicings ALTER COLUMN id SET DEFAULT nextval('public.voicings_id_seq'::regclass);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: clef_combinations clef_combinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clef_combinations
    ADD CONSTRAINT clef_combinations_pkey PRIMARY KEY (id);


--
-- Name: composers composers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composers
    ADD CONSTRAINT composers_pkey PRIMARY KEY (id);


--
-- Name: composition_types composition_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.composition_types
    ADD CONSTRAINT composition_types_pkey PRIMARY KEY (id);


--
-- Name: compositions compositions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compositions
    ADD CONSTRAINT compositions_pkey PRIMARY KEY (id);


--
-- Name: editions editions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editions
    ADD CONSTRAINT editions_pkey PRIMARY KEY (id);


--
-- Name: editors editors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.editors
    ADD CONSTRAINT editors_pkey PRIMARY KEY (id);


--
-- Name: functions functions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.functions
    ADD CONSTRAINT functions_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: ignored_alerts ignored_alerts_alert_type_entity_type_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ignored_alerts
    ADD CONSTRAINT ignored_alerts_alert_type_entity_type_entity_id_key UNIQUE (alert_type, entity_type, entity_id);


--
-- Name: ignored_alerts ignored_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ignored_alerts
    ADD CONSTRAINT ignored_alerts_pkey PRIMARY KEY (id);


--
-- Name: inclusions inclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inclusions
    ADD CONSTRAINT inclusions_pkey PRIMARY KEY (id);


--
-- Name: languages languages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.languages
    ADD CONSTRAINT languages_pkey PRIMARY KEY (id);


--
-- Name: performers performers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.performers
    ADD CONSTRAINT performers_pkey PRIMARY KEY (id);


--
-- Name: publishers publishers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publishers
    ADD CONSTRAINT publishers_pkey PRIMARY KEY (id);


--
-- Name: recordings recordings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: scribes scribes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scribes
    ADD CONSTRAINT scribes_pkey PRIMARY KEY (id);


--
-- Name: user_sessions session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT session_pkey PRIMARY KEY (sid);


--
-- Name: source_images source_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_images
    ADD CONSTRAINT source_images_pkey PRIMARY KEY (id);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: suggestion_flags suggestion_flags_group1_id_group2_id_flag_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags
    ADD CONSTRAINT suggestion_flags_group1_id_group2_id_flag_type_key UNIQUE (group1_id, group2_id, flag_type);


--
-- Name: suggestion_flags suggestion_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags
    ADD CONSTRAINT suggestion_flags_pkey PRIMARY KEY (id);


--
-- Name: temp_inclusions temp_inclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.temp_inclusions
    ADD CONSTRAINT temp_inclusions_pkey PRIMARY KEY (id);


--
-- Name: titles titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.titles
    ADD CONSTRAINT titles_pkey PRIMARY KEY (id);


--
-- Name: user_permissions user_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_pkey PRIMARY KEY (user_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: voicings voicings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voicings
    ADD CONSTRAINT voicings_pkey PRIMARY KEY (id);


--
-- Name: IDX_session_expire; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "IDX_session_expire" ON public.user_sessions USING btree (expire);


--
-- Name: idx_audit_log_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_created_at ON public.audit_log USING btree (created_at DESC);


--
-- Name: idx_audit_log_table_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_table_action ON public.audit_log USING btree (table_name, action);


--
-- Name: idx_audit_log_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_log_user_id ON public.audit_log USING btree (user_id);


--
-- Name: idx_composers_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_composers_dates ON public.composers USING btree (from_year, to_year) WHERE ((from_year IS NOT NULL) OR (to_year IS NOT NULL));


--
-- Name: idx_compositions_composer_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compositions_composer_list ON public.compositions USING gin (composer_id_list) WHERE (composer_id_list IS NOT NULL);


--
-- Name: idx_compositions_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compositions_group_id ON public.compositions USING btree (group_id);


--
-- Name: idx_compositions_group_id_voices; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compositions_group_id_voices ON public.compositions USING btree (group_id, number_of_voices) WHERE (group_id IS NOT NULL);


--
-- Name: idx_compositions_tone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compositions_tone ON public.compositions USING btree (tone);


--
-- Name: idx_ignored_alerts_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ignored_alerts_lookup ON public.ignored_alerts USING btree (alert_type, entity_type, entity_id);


--
-- Name: idx_ignored_alerts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ignored_alerts_user ON public.ignored_alerts USING btree (ignored_by);


--
-- Name: idx_inclusions_attribution_texts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_attribution_texts ON public.inclusions USING gin (attribution_texts);


--
-- Name: idx_inclusions_clefs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_clefs ON public.inclusions USING gin (clefs);


--
-- Name: idx_inclusions_composer_ids; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_composer_ids ON public.inclusions USING gin (composer_ids);


--
-- Name: idx_inclusions_composition_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_composition_group ON public.inclusions USING btree (composition_id);


--
-- Name: idx_inclusions_composition_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_composition_source ON public.inclusions USING btree (composition_id, source_id);


--
-- Name: idx_inclusions_sorted_clef_combination_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_sorted_clef_combination_all ON public.inclusions USING btree (sorted_clef_combination_all) WHERE (sorted_clef_combination_all IS NOT NULL);


--
-- Name: idx_inclusions_sorted_clef_combination_required; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inclusions_sorted_clef_combination_required ON public.inclusions USING btree (sorted_clef_combination_required) WHERE (sorted_clef_combination_required IS NOT NULL);


--
-- Name: idx_sources_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sources_dates ON public.sources USING btree (from_year, to_year) WHERE ((from_year IS NOT NULL) OR (to_year IS NOT NULL));


--
-- Name: idx_title_word_cache_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_title_word_cache_group ON public.title_word_cache USING btree (group_id);


--
-- Name: idx_title_word_cache_words; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_title_word_cache_words ON public.title_word_cache USING gin (words);


--
-- Name: idx_titles_text_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_titles_text_trgm ON public.titles USING gin (text public.gin_trgm_ops);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_is_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_admin ON public.users USING btree (is_admin);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: index_clef_combinations_voicings_on_clef_combination_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_clef_combinations_voicings_on_clef_combination_id ON public.clef_combinations_voicings USING btree (clef_combination_id);


--
-- Name: index_clef_combinations_voicings_on_voicing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_clef_combinations_voicings_on_voicing_id ON public.clef_combinations_voicings USING btree (voicing_id);


--
-- Name: index_compositions_on_composer_id_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_composer_id_list ON public.compositions USING gin (composer_id_list);


--
-- Name: index_compositions_on_composition_type_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_composition_type_id ON public.compositions USING btree (composition_type_id);


--
-- Name: index_compositions_on_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_group_id ON public.compositions USING btree (group_id);


--
-- Name: index_compositions_on_number_of_voices; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_number_of_voices ON public.compositions USING btree (number_of_voices);


--
-- Name: index_compositions_on_number_of_voices_and_title_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_number_of_voices_and_title_id ON public.compositions USING btree (number_of_voices, title_id);


--
-- Name: index_compositions_on_title_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_compositions_on_title_id ON public.compositions USING btree (title_id);


--
-- Name: index_editions_on_editor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_editions_on_editor_id ON public.editions USING btree (editor_id);


--
-- Name: index_editions_on_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_editions_on_group_id ON public.editions USING btree (group_id);


--
-- Name: index_functions_titles_on_function_id_and_title_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_functions_titles_on_function_id_and_title_id ON public.functions_titles USING btree (function_id, title_id);


--
-- Name: index_inclusions_on_composition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inclusions_on_composition_id ON public.inclusions USING btree (composition_id);


--
-- Name: index_inclusions_on_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inclusions_on_source_id ON public.inclusions USING btree (source_id);


--
-- Name: index_publishers_sources_on_publisher_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_publishers_sources_on_publisher_id ON public.publishers_sources USING btree (publisher_id);


--
-- Name: index_publishers_sources_on_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_publishers_sources_on_source_id ON public.publishers_sources USING btree (source_id);


--
-- Name: index_recordings_on_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recordings_on_group_id ON public.recordings USING btree (group_id);


--
-- Name: index_recordings_on_performer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recordings_on_performer_id ON public.recordings USING btree (performer_id);


--
-- Name: index_recordings_on_unique_piece_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recordings_on_unique_piece_id ON public.recordings USING btree (unique_piece_id);


--
-- Name: index_scribes_sources_on_scribe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_scribes_sources_on_scribe_id ON public.scribes_sources USING btree (scribe_id);


--
-- Name: index_scribes_sources_on_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_scribes_sources_on_source_id ON public.scribes_sources USING btree (source_id);


--
-- Name: index_titles_on_text; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_titles_on_text ON public.titles USING btree (text);


--
-- Name: source_images_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_images_source_id_idx ON public.source_images USING btree (source_id);


--
-- Name: inclusions trg_update_sorted_clef_combinations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_sorted_clef_combinations BEFORE INSERT OR UPDATE OF clefs ON public.inclusions FOR EACH ROW EXECUTE FUNCTION public.update_sorted_clef_combinations();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: audit_log audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: ignored_alerts ignored_alerts_ignored_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ignored_alerts
    ADD CONSTRAINT ignored_alerts_ignored_by_fkey FOREIGN KEY (ignored_by) REFERENCES public.users(id);


--
-- Name: source_images source_images_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_images
    ADD CONSTRAINT source_images_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.sources(id);


--
-- Name: suggestion_flags suggestion_flags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags
    ADD CONSTRAINT suggestion_flags_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: suggestion_flags suggestion_flags_group1_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags
    ADD CONSTRAINT suggestion_flags_group1_id_fkey FOREIGN KEY (group1_id) REFERENCES public.groups(id);


--
-- Name: suggestion_flags suggestion_flags_group2_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suggestion_flags
    ADD CONSTRAINT suggestion_flags_group2_id_fkey FOREIGN KEY (group2_id) REFERENCES public.groups(id);


--
-- Name: user_permissions user_permissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: user_permissions user_permissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_permissions
    ADD CONSTRAINT user_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

