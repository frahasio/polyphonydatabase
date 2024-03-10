SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: heroku_ext; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA heroku_ext;


--
-- Name: intarray; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS intarray WITH SCHEMA public;


--
-- Name: EXTENSION intarray; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION intarray IS 'functions, operators, and index support for 1-D arrays of integers';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA heroku_ext;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


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
-- Name: attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attributions (
    id integer NOT NULL,
    inclusion_id integer,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    text character varying,
    refers_to_id integer,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(text, ''::character varying))::text), 'A'::"char")) STORED
);


--
-- Name: attributions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.attributions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: attributions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.attributions_id_seq OWNED BY public.attributions.id;


--
-- Name: clef_combinations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clef_combinations (
    id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    clef_ids integer[] DEFAULT '{}'::integer[],
    sorting character varying
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
-- Name: clefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clefs (
    id integer NOT NULL,
    note character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    optional boolean DEFAULT false NOT NULL
);


--
-- Name: clefs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clefs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clefs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clefs_id_seq OWNED BY public.clefs.id;


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
-- Name: composers_compositions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.composers_compositions (
    composer_id integer NOT NULL,
    composition_id integer NOT NULL
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
    tone integer,
    even_odd integer,
    composer_id_list integer[]
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
    editor_id integer,
    has_pdf boolean DEFAULT false,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (((COALESCE(voicing, ''::character varying))::text || ' '::text) || (COALESCE(file_url, ''::character varying))::text)), 'A'::"char")) STORED
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
    updated_at timestamp without time zone NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(display_title, ''::character varying))::text), 'A'::"char")) STORED
);


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
-- Name: inclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inclusions (
    id integer NOT NULL,
    source_id integer,
    notes character varying,
    "order" integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    "position" integer,
    composition_id integer,
    missing_clef_ids integer[] DEFAULT '{}'::integer[],
    incomplete_clef_ids integer[] DEFAULT '{}'::integer[],
    clef_combination_id integer,
    transitions_to json,
    both_clef_ids integer[] DEFAULT '{}'::integer[]
);


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
    performer_id integer,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(file_url, ''::character varying))::text), 'A'::"char")) STORED
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
    url character varying,
    catalogued boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    from_year integer,
    to_year integer,
    from_year_annotation character varying,
    to_year_annotation character varying,
    dates character varying,
    location_and_pubscribe character varying,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, ((((((((COALESCE(title, ''::text) || ' '::text) || (COALESCE(code, ''::character varying))::text) || ' '::text) || (COALESCE(location_and_pubscribe, ''::character varying))::text) || ' '::text) || (COALESCE(dates, ''::character varying))::text) || ' '::text) || (COALESCE(type, ''::character varying))::text)), 'A'::"char")) STORED
);


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
-- Name: titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.titles (
    id integer NOT NULL,
    text character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, (COALESCE(text, ''::character varying))::text), 'A'::"char")) STORED,
    language integer
);


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
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying,
    password character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
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
-- Name: voicings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voicings (
    id integer NOT NULL,
    text character varying,
    created_at timestamp without time zone NOT NULL,
    updated_at timestamp without time zone NOT NULL
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
-- Name: attributions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attributions ALTER COLUMN id SET DEFAULT nextval('public.attributions_id_seq'::regclass);


--
-- Name: clef_combinations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clef_combinations ALTER COLUMN id SET DEFAULT nextval('public.clef_combinations_id_seq'::regclass);


--
-- Name: clefs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clefs ALTER COLUMN id SET DEFAULT nextval('public.clefs_id_seq'::regclass);


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
-- Name: sources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources ALTER COLUMN id SET DEFAULT nextval('public.sources_id_seq'::regclass);


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
-- Name: attributions attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attributions
    ADD CONSTRAINT attributions_pkey PRIMARY KEY (id);


--
-- Name: clef_combinations clef_combinations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clef_combinations
    ADD CONSTRAINT clef_combinations_pkey PRIMARY KEY (id);


--
-- Name: clefs clefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clefs
    ADD CONSTRAINT clefs_pkey PRIMARY KEY (id);


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
-- Name: inclusions inclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inclusions
    ADD CONSTRAINT inclusions_pkey PRIMARY KEY (id);


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
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: titles titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.titles
    ADD CONSTRAINT titles_pkey PRIMARY KEY (id);


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
-- Name: index_attributions_on_inclusion_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_attributions_on_inclusion_id ON public.attributions USING btree (inclusion_id);


--
-- Name: index_clef_combinations_voicings_on_clef_combination_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_clef_combinations_voicings_on_clef_combination_id ON public.clef_combinations_voicings USING btree (clef_combination_id);


--
-- Name: index_clef_combinations_voicings_on_voicing_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_clef_combinations_voicings_on_voicing_id ON public.clef_combinations_voicings USING btree (voicing_id);


--
-- Name: index_clefs_on_note_and_optional; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_clefs_on_note_and_optional ON public.clefs USING btree (note, optional);


--
-- Name: index_composers_compositions_on_composer_id_and_composition_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_composers_compositions_on_composer_id_and_composition_id ON public.composers_compositions USING btree (composer_id, composition_id);


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
-- Name: index_compositions_on_unique_fields; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_compositions_on_unique_fields ON public.compositions USING btree (composer_id_list, composition_type_id, even_odd, number_of_voices, title_id, tone);


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
-- Name: index_inclusions_on_clef_combination_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inclusions_on_clef_combination_id ON public.inclusions USING btree (clef_combination_id);


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
-- Name: search_vector_index; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_vector_index ON public.recordings USING gin (search_vector);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20240211130206'),
('20230514115400'),
('20230505092834'),
('20180617135201'),
('20180512153825'),
('20180430120112'),
('20180415150714'),
('20180415144208'),
('20180408131628'),
('20180407115406'),
('20180403134448'),
('20180402172029'),
('20180402152125'),
('20180331135428'),
('20180325125112'),
('20180310204933'),
('20180310200940'),
('20180305122652'),
('20180303154615'),
('20180303151137'),
('20170827061854'),
('20170726133540'),
('20170722110438'),
('20170713192222'),
('20170709123723'),
('20170709115805'),
('20170708201857'),
('20170708111404'),
('20170317194007');

