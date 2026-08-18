\restrict dbmate

-- Dumped from database version 16.14
-- Dumped by pg_dump version 18.4

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

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: properties_guard_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.properties_guard_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    allowed BOOLEAN;
BEGIN
    allowed := CASE OLD.status
        WHEN 'prospecto'  THEN NEW.status IN ('oferta', 'archivada')
        WHEN 'oferta'     THEN NEW.status IN ('desarrollo', 'archivada')
        WHEN 'desarrollo' THEN NEW.status IN ('en_renta', 'vendida', 'archivada')
        WHEN 'en_renta'   THEN NEW.status IN ('vendida', 'archivada')
        -- vendida es terminal: una propiedad vendida ES el track record de la
        -- firma y no puede desaparecer de él archivándola
        WHEN 'vendida'    THEN FALSE
        WHEN 'archivada'  THEN FALSE
        ELSE FALSE
    END;

    -- Los mensajes hablan el vocabulario de docs/glosario.md, no el del esquema:
    -- son lo último que ve alguien que empujó un UPDATE a mano, y «en_renta» o
    -- «projected_sale > 0» no le dicen qué capturar.
    IF NOT allowed THEN
        RAISE EXCEPTION 'No se puede pasar de % a % (propiedad %)',
            property_status_label(OLD.status), property_status_label(NEW.status), OLD.id
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'oferta' AND coalesce(NEW.projected_sale, 0) <= 0 THEN
        RAISE EXCEPTION 'Toda Oferta modela su salida: falta la venta proyectada (propiedad %)',
            OLD.id USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'desarrollo' THEN
        IF NEW.acquisition_date IS NULL THEN
            RAISE EXCEPTION 'Una propiedad en Desarrollo ya se compró: falta la fecha de adquisición (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.total_units IS NULL THEN
            RAISE EXCEPTION 'Falta el número de unidades para pasar a Desarrollo (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
        -- Comprar no produce un avalúo: la valuación NO se exige aquí.
        IF coalesce(NEW.purchase_price, 0) <= 0 THEN
            RAISE EXCEPTION 'No se entra a Desarrollo sin saber qué se pagó: falta el precio de compra (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.status = 'en_renta' THEN
        IF NEW.rent_monthly_actual IS NULL THEN
            RAISE EXCEPTION 'Falta la renta mensual cobrada para pasar a En renta: la que se cobra, no la estimada (propiedad %)',
                OLD.id USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: properties_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.properties_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


--
-- Name: property_status_label(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.property_status_label(status text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT CASE status
        WHEN 'prospecto'  THEN 'Prospecto'
        WHEN 'oferta'     THEN 'Oferta'
        WHEN 'desarrollo' THEN 'Desarrollo'
        WHEN 'en_renta'   THEN 'En renta'
        WHEN 'vendida'    THEN 'Vendida'
        WHEN 'archivada'  THEN 'Archivada'
        ELSE status
    END;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name text NOT NULL,
    key_hash text NOT NULL,
    key_prefix text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked boolean DEFAULT false NOT NULL
);


--
-- Name: api_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_keys_id_seq OWNED BY public.api_keys.id;


--
-- Name: budget_line_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_line_payments (
    id bigint NOT NULL,
    line_id bigint NOT NULL,
    amount numeric(14,2) NOT NULL,
    paid_on date DEFAULT CURRENT_DATE NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budget_line_payments_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: budget_line_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_line_payments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_line_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_line_payments_id_seq OWNED BY public.budget_line_payments.id;


--
-- Name: budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budget_lines (
    id bigint NOT NULL,
    budget_id bigint NOT NULL,
    chapter_name text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    supplier_id bigint,
    committed_amount numeric(14,2),
    committed_on date,
    actual_quantity numeric(14,3),
    closed_at timestamp with time zone,
    sort_order integer DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_residual boolean DEFAULT false NOT NULL,
    supplier_category_id bigint,
    is_proportional boolean DEFAULT true NOT NULL,
    CONSTRAINT budget_lines_actual_quantity_check CHECK ((actual_quantity >= (0)::numeric)),
    CONSTRAINT budget_lines_chapter_name_check CHECK ((chapter_name <> ''::text)),
    CONSTRAINT budget_lines_closed_needs_actual_quantity CHECK (((closed_at IS NULL) OR ((actual_quantity IS NOT NULL) AND (actual_quantity > (0)::numeric)))),
    CONSTRAINT budget_lines_committed_amount_check CHECK ((committed_amount >= (0)::numeric)),
    CONSTRAINT budget_lines_name_check CHECK ((name <> ''::text)),
    CONSTRAINT budget_lines_quantity_check CHECK ((quantity >= (0)::numeric)),
    CONSTRAINT budget_lines_residual_has_no_category CHECK (((NOT is_residual) OR (supplier_category_id IS NULL))),
    CONSTRAINT budget_lines_unit_check CHECK ((unit <> ''::text)),
    CONSTRAINT budget_lines_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: COLUMN budget_lines.is_residual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.budget_lines.is_residual IS 'El renglón que absorbe lo que todavía no se detalla: su importe es el total del presupuesto menos la suma de los detallados. No se captura a mano — convertir una resta determinista en una segunda captura es donde nace el descuadre. Uno por presupuesto, y el índice único parcial lo garantiza.';


--
-- Name: COLUMN budget_lines.supplier_category_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.budget_lines.supplier_category_id IS 'El oficio que este renglón requiere, COPIADO del catálogo al instanciar como el nombre, la unidad y el precio: editar el catálogo después no lo mueve. FILTRA el selector de proveedores por id —no por el nombre del capítulo, que era una coincidencia de textos— y nunca restringe: el día que el plomero haga albañilería tiene que poder capturarse. Que un renglón tenga oficio y todavía no proveedor es el estado normal mientras se presupuesta.';


--
-- Name: COLUMN budget_lines.is_proportional; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.budget_lines.is_proportional IS '¿Esta partida crece con el tamaño de la obra? TRUE es el caso común y por eso es el default: la casa del doble de tamaño lleva el doble de piso. FALSE es la partida de monto propio —permisos, licencias, conexiones—: cuesta lo que cuesta y la copia proporcional la deja intacta, con su importe original. Es verdad de la PARTIDA, no de una copia, y por eso se guarda y VIAJA con ella: un presupuesto copiado nace sabiendo cuáles no escalan. Qué mueve el factor lo decide la unidad: en «lote» —suma alzada, sin medida detrás— escala el PRECIO, y el renglón se sigue leyendo «1 lote»; en m², ml o pza escala la CANTIDAD, porque el precio por unidad es un hecho de mercado que no cambia porque la casa sea más grande.';


--
-- Name: budget_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budget_lines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budget_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budget_lines_id_seq OWNED BY public.budget_lines.id;


--
-- Name: budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.budgets (
    id bigint NOT NULL,
    property_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: budget_price_observations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.budget_price_observations AS
 SELECT l.id AS line_id,
    b.property_id,
    l.chapter_name,
    l.name,
    l.unit,
    l.supplier_id,
    l.closed_at,
    l.quantity AS budgeted_quantity,
    l.actual_quantity,
    (l.quantity * l.unit_price) AS budgeted_amount,
    pagos.paid_amount,
    l.unit_price AS budgeted_unit_price,
    round((pagos.paid_amount / l.actual_quantity), 2) AS actual_unit_price
   FROM ((public.budget_lines l
     JOIN public.budgets b ON ((b.id = l.budget_id)))
     JOIN LATERAL ( SELECT COALESCE(sum(p.amount), (0)::numeric) AS paid_amount
           FROM public.budget_line_payments p
          WHERE (p.line_id = l.id)) pagos ON (true))
  WHERE ((l.closed_at IS NOT NULL) AND (pagos.paid_amount > (0)::numeric));


--
-- Name: VIEW budget_price_observations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.budget_price_observations IS 'Historia de precios: un renglón CERRADO con lo que se pagó por unidad y lo que se había presupuestado. Los renglones abiertos y los cierres sin un peso pagado quedan fuera — cada uno envenena la mediana en silencio, el primero contando anticipos como precios finales y el segundo metiendo ceros.';


--
-- Name: budgets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.budgets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: budgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.budgets_id_seq OWNED BY public.budgets.id;


--
-- Name: comparable_check_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comparable_check_log (
    id bigint NOT NULL,
    comparable_id bigint NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    result text NOT NULL,
    detail text DEFAULT ''::text NOT NULL,
    CONSTRAINT comparable_check_log_result_check CHECK ((result = ANY (ARRAY['active'::text, 'sold'::text, 'error'::text, 'timeout'::text, 'redirect'::text])))
);


--
-- Name: comparable_check_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comparable_check_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comparable_check_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comparable_check_log_id_seq OWNED BY public.comparable_check_log.id;


--
-- Name: comparables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comparables (
    id bigint NOT NULL,
    address text NOT NULL,
    zone_id bigint,
    m2 real NOT NULL,
    price numeric(14,2) NOT NULL,
    listing_url text NOT NULL,
    source_portal text NOT NULL,
    listed_at timestamp with time zone NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    neighborhood text DEFAULT ''::text NOT NULL,
    city text DEFAULT 'Monterrey'::text NOT NULL,
    lat double precision,
    lng double precision,
    bedrooms integer,
    bathrooms integer,
    parking_spots integer,
    property_type text DEFAULT 'casa'::text NOT NULL,
    condition text DEFAULT 'remodelada'::text NOT NULL,
    style_tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_checked_at timestamp with time zone,
    last_seen_active timestamp with time zone DEFAULT now() NOT NULL,
    sold_at timestamp with time zone,
    check_failure_count integer DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    price_per_m2 numeric(14,2) GENERATED ALWAYS AS (((price)::double precision / NULLIF(m2, (0)::double precision))) STORED,
    CONSTRAINT comparables_address_check CHECK ((address <> ''::text)),
    CONSTRAINT comparables_condition_check CHECK ((condition = ANY (ARRAY['remodelada'::text, 'nueva'::text, 'semi_nueva'::text, 'por_remodelar'::text]))),
    CONSTRAINT comparables_listing_url_check CHECK ((listing_url <> ''::text)),
    CONSTRAINT comparables_m2_check CHECK ((m2 > (0)::double precision)),
    CONSTRAINT comparables_price_check CHECK ((price > (0)::numeric)),
    CONSTRAINT comparables_property_type_check CHECK ((property_type = ANY (ARRAY['casa'::text, 'depto'::text, 'duplex'::text, 'lote'::text, 'local'::text]))),
    CONSTRAINT comparables_source_portal_check CHECK ((source_portal = ANY (ARRAY['inmuebles24'::text, 'vivanuncios'::text, 'lamudi'::text, 'propiedades_com'::text, 'mercadolibre'::text, 'doorvel'::text, 'off_market'::text, 'other'::text]))),
    CONSTRAINT comparables_status_check CHECK ((status = ANY (ARRAY['active'::text, 'sold'::text, 'withdrawn'::text, 'expired'::text])))
);


--
-- Name: comparables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comparables_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comparables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comparables_id_seq OWNED BY public.comparables.id;


--
-- Name: cotizaciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cotizaciones (
    id bigint NOT NULL,
    instance_node_state_id bigint NOT NULL,
    proveedor_id bigint,
    proveedor_name_override text DEFAULT ''::text NOT NULL,
    monto numeric(14,2) DEFAULT 0 NOT NULL,
    moneda text DEFAULT 'MXN'::text NOT NULL,
    descripcion text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    fecha_cotizacion date,
    validez_dias integer,
    archivo_path text,
    archivo_nombre text,
    is_selected boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cotizaciones_moneda_check CHECK ((moneda = ANY (ARRAY['MXN'::text, 'USD'::text]))),
    CONSTRAINT cotizaciones_monto_check CHECK ((monto >= (0)::numeric)),
    CONSTRAINT cotizaciones_validez_dias_check CHECK ((validez_dias > 0))
);


--
-- Name: cotizaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.cotizaciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: cotizaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.cotizaciones_id_seq OWNED BY public.cotizaciones.id;


--
-- Name: instance_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instance_files (
    id bigint NOT NULL,
    instance_id bigint NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: instance_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.instance_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: instance_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.instance_files_id_seq OWNED BY public.instance_files.id;


--
-- Name: instance_node_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instance_node_states (
    id bigint NOT NULL,
    instance_id bigint NOT NULL,
    template_node_id bigint NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    assignee_id bigint,
    actual_start text,
    actual_end text,
    notes text DEFAULT ''::text NOT NULL,
    duration_override_days integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_id bigint
);


--
-- Name: instance_node_states_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.instance_node_states_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: instance_node_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.instance_node_states_id_seq OWNED BY public.instance_node_states.id;


--
-- Name: investors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investors (
    id bigint NOT NULL,
    name text NOT NULL,
    apellidos text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    temperatura text,
    capacidad text,
    fuente text,
    confianza text,
    CONSTRAINT investors_capacidad_check CHECK ((capacidad = ANY (ARRAY['<500k'::text, '500k-2M'::text, '2M-5M'::text, '5M+'::text]))),
    CONSTRAINT investors_confianza_check CHECK ((confianza = ANY (ARRAY['bajo'::text, 'medio'::text, 'alto'::text]))),
    CONSTRAINT investors_fuente_check CHECK ((fuente = ANY (ARRAY['red_personal'::text, 'referido'::text, 'red_negocios'::text, 'linkedin'::text, 'otro'::text]))),
    CONSTRAINT investors_name_check CHECK ((name <> ''::text)),
    CONSTRAINT investors_temperatura_check CHECK ((temperatura = ANY (ARRAY['caliente'::text, 'tibio'::text, 'frio'::text])))
);


--
-- Name: investors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.investors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: investors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.investors_id_seq OWNED BY public.investors.id;


--
-- Name: node_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_comments (
    id bigint NOT NULL,
    instance_id bigint NOT NULL,
    template_node_id bigint NOT NULL,
    body text NOT NULL,
    author text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: node_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.node_comments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: node_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.node_comments_id_seq OWNED BY public.node_comments.id;


--
-- Name: node_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.node_files (
    id bigint NOT NULL,
    template_node_id bigint NOT NULL,
    instance_id bigint,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    type text DEFAULT 'reference'::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: node_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.node_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: node_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.node_files_id_seq OWNED BY public.node_files.id;


--
-- Name: process_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_instances (
    id bigint NOT NULL,
    template_id bigint,
    owner_id bigint,
    task_type text DEFAULT 'proyecto'::text NOT NULL,
    name text NOT NULL,
    start_date text NOT NULL,
    due_date text,
    frequency_days integer,
    origin_instance_id bigint,
    completed_at text,
    duration_locked_at text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    property_id bigint,
    CONSTRAINT process_instances_name_check CHECK ((name <> ''::text))
);


--
-- Name: process_instances_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.process_instances_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: process_instances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.process_instances_id_seq OWNED BY public.process_instances.id;


--
-- Name: process_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_templates (
    id bigint NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT process_templates_name_check CHECK ((name <> ''::text))
);


--
-- Name: process_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.process_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: process_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.process_templates_id_seq OWNED BY public.process_templates.id;


--
-- Name: profit_split_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profit_split_config (
    id bigint NOT NULL,
    exit_price numeric(14,2),
    investor_capital numeric(14,2),
    investor_rate_annual real DEFAULT 0.12 NOT NULL,
    investor_months real,
    isr_rate real DEFAULT 0.30 NOT NULL,
    finder_fee_pct real DEFAULT 0.0 NOT NULL,
    director_pct real DEFAULT 0.0 NOT NULL,
    responsable_pct real DEFAULT 0.0 NOT NULL,
    lider_pct real DEFAULT 0.0 NOT NULL,
    maestro_pct real DEFAULT 0.0 NOT NULL,
    ayudante_pct real DEFAULT 0.0 NOT NULL,
    finder_member_id bigint,
    responsable_member_id bigint,
    lider_member_id bigint,
    maestro_member_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    ayudante_member_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    maestro_count integer,
    ayudante_count integer,
    planned_end_date text,
    actual_end_date text,
    buffer_days integer DEFAULT 0 NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    property_id bigint
);


--
-- Name: profit_split_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.profit_split_config_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: profit_split_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.profit_split_config_id_seq OWNED BY public.profit_split_config.id;


--
-- Name: project_images_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_images_legacy (
    id bigint NOT NULL,
    project_id bigint NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    image_type text DEFAULT 'antes'::text NOT NULL,
    CONSTRAINT project_images_image_type_check CHECK ((image_type = ANY (ARRAY['antes'::text, 'despues'::text])))
);


--
-- Name: project_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_images_id_seq OWNED BY public.project_images_legacy.id;


--
-- Name: projects_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects_legacy (
    id bigint NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    status text NOT NULL,
    total_units integer NOT NULL,
    acquisition_date text NOT NULL,
    conclusion_date date NOT NULL,
    total_investment numeric(14,2) NOT NULL,
    current_valuation numeric(14,2) NOT NULL,
    valuation_date text NOT NULL,
    url text NOT NULL,
    latitude real NOT NULL,
    longitude real NOT NULL,
    prospect_id bigint,
    milestones text DEFAULT '{}'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    is_favorite boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sqm_land real,
    sqm_construction real,
    land_price numeric(14,2),
    acquisition_cost_pct real,
    permits_cost numeric(14,2),
    subdivision_cost numeric(14,2),
    construction_cost_per_sqm numeric(14,2),
    construction_overhead real,
    projected_sale numeric(14,2),
    hold_months integer,
    rent_monthly numeric(14,2),
    geometry jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT projects_acquisition_date_check CHECK ((acquisition_date <> ''::text)),
    CONSTRAINT projects_address_check CHECK ((address <> ''::text)),
    CONSTRAINT projects_city_check CHECK ((city <> ''::text)),
    CONSTRAINT projects_name_check CHECK ((name <> ''::text)),
    CONSTRAINT projects_status_check CHECK ((status <> ''::text)),
    CONSTRAINT projects_type_check CHECK ((type <> ''::text)),
    CONSTRAINT projects_url_check CHECK ((url <> ''::text)),
    CONSTRAINT projects_valuation_date_check CHECK ((valuation_date <> ''::text))
);


--
-- Name: projects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects_legacy.id;


--
-- Name: properties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.properties (
    id bigint NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    url text DEFAULT ''::text NOT NULL,
    latitude real NOT NULL,
    longitude real NOT NULL,
    status text NOT NULL,
    asset_type text,
    strategy_type text,
    sqm_land real,
    sqm_construction real,
    purchase_price numeric(14,2),
    acquisition_cost_pct real,
    permits_cost numeric(14,2),
    subdivision_cost numeric(14,2),
    construction_cost_per_sqm numeric(14,2),
    construction_overhead real,
    projected_sale numeric(14,2),
    hold_months integer,
    rent_monthly_projected numeric(14,2),
    total_units integer,
    acquisition_date date,
    first_rent_date date,
    sale_date date,
    sale_price numeric(14,2),
    current_valuation numeric(14,2),
    valuation_date date,
    milestones jsonb DEFAULT '{}'::jsonb NOT NULL,
    geometry jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    is_favorite boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rent_monthly_actual numeric(14,2),
    CONSTRAINT properties_acquisition_cost_pct_check CHECK ((acquisition_cost_pct >= (0)::double precision)),
    CONSTRAINT properties_address_check CHECK ((address <> ''::text)),
    CONSTRAINT properties_asset_type_check CHECK ((asset_type = ANY (ARRAY['casa'::text, 'departamento'::text, 'local'::text, 'edificio'::text, 'lote'::text, 'bodega'::text]))),
    CONSTRAINT properties_city_check CHECK ((city <> ''::text)),
    CONSTRAINT properties_construction_cost_per_sqm_check CHECK ((construction_cost_per_sqm >= (0)::numeric)),
    CONSTRAINT properties_construction_overhead_check CHECK ((construction_overhead >= (0)::double precision)),
    CONSTRAINT properties_current_valuation_check CHECK ((current_valuation >= (0)::numeric)),
    CONSTRAINT properties_en_renta_needs_first_rent CHECK (((status <> 'en_renta'::text) OR (first_rent_date IS NOT NULL))),
    CONSTRAINT properties_first_rent_after_acquisition CHECK (((first_rent_date IS NULL) OR (acquisition_date IS NULL) OR (first_rent_date >= acquisition_date))),
    CONSTRAINT properties_hold_months_check CHECK ((hold_months > 0)),
    CONSTRAINT properties_milestones_check CHECK ((jsonb_typeof(milestones) = 'object'::text)),
    CONSTRAINT properties_name_check CHECK ((name <> ''::text)),
    CONSTRAINT properties_permits_cost_check CHECK ((permits_cost >= (0)::numeric)),
    CONSTRAINT properties_projected_sale_check CHECK ((projected_sale >= (0)::numeric)),
    CONSTRAINT properties_purchase_price_check CHECK ((purchase_price >= (0)::numeric)),
    CONSTRAINT properties_rent_monthly_actual_check CHECK ((rent_monthly_actual > (0)::numeric)),
    CONSTRAINT properties_rent_monthly_projected_check CHECK ((rent_monthly_projected > (0)::numeric)),
    CONSTRAINT properties_sale_after_acquisition CHECK (((sale_date IS NULL) OR (acquisition_date IS NULL) OR (sale_date >= acquisition_date))),
    CONSTRAINT properties_sale_after_first_rent CHECK (((sale_date IS NULL) OR (first_rent_date IS NULL) OR (sale_date >= first_rent_date))),
    CONSTRAINT properties_sale_price_check CHECK ((sale_price >= (0)::numeric)),
    CONSTRAINT properties_sqm_construction_check CHECK ((sqm_construction >= (0)::double precision)),
    CONSTRAINT properties_sqm_land_check CHECK ((sqm_land >= (0)::double precision)),
    CONSTRAINT properties_status_check CHECK ((status = ANY (ARRAY['prospecto'::text, 'oferta'::text, 'desarrollo'::text, 'en_renta'::text, 'vendida'::text, 'archivada'::text]))),
    CONSTRAINT properties_strategy_type_check CHECK ((strategy_type = ANY (ARRAY['adaptive_reuse'::text, 'ground_up'::text, 'flip'::text, 'hold'::text]))),
    CONSTRAINT properties_subdivision_cost_check CHECK ((subdivision_cost >= (0)::numeric)),
    CONSTRAINT properties_total_units_check CHECK ((total_units > 0)),
    CONSTRAINT properties_vendida_needs_sale CHECK (((status <> 'vendida'::text) OR ((sale_date IS NOT NULL) AND (sale_price IS NOT NULL))))
);


--
-- Name: COLUMN properties.sqm_construction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.sqm_construction IS 'Metros cuadrados de obra A EJECUTAR — la que se va a construir o remodelar, no la que el inmueble ya tiene. Sobrevive al presupuesto: es metraje FÍSICO y lo leen el analizador de mercado y el PDF, a los que no les importa cuánto cueste la obra.';


--
-- Name: COLUMN properties.purchase_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.purchase_price IS 'Lo que se paga por adquirir el inmueble como está (lote o construido). La obra a ejecutar se suma aparte.';


--
-- Name: COLUMN properties.acquisition_cost_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.acquisition_cost_pct IS 'Supuesto: costos de adquisición como fracción del precio de compra. NULL = se aplica el default del sistema (0.065). Un 0 capturado dice que el precio de compra ya viene con todo adentro.';


--
-- Name: COLUMN properties.construction_cost_per_sqm; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.construction_cost_per_sqm IS 'RETIRADA como insumo del costo de obra: desde la fase 2 el costo de obra es la suma del presupuesto (budget_lines) y esta cifra se DERIVA —presupuesto ÷ m² de obra— para mostrarse. El API ya no la lee ni la escribe; solo las semillas la usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';


--
-- Name: COLUMN properties.construction_overhead; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.construction_overhead IS 'RETIRADO como multiplicador vivo: la 032 lo aplicó UNA sola vez al sembrar y el 30% de indirectos ya vive dentro del importe del presupuesto. Volver a multiplicar por él inflaría cada costo de obra sin que nada se viera roto. El API ya no lo lee ni lo publica como supuesto; solo las semillas lo usan para calcular el primer renglón. Pendiente de DROP junto con la reescritura de db/seeds.';


--
-- Name: COLUMN properties.hold_months; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.hold_months IS 'Supuesto: plazo proyectado en meses. NULL = se aplica el default del sistema (12).';


--
-- Name: COLUMN properties.rent_monthly_projected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.rent_monthly_projected IS 'Renta mensual del underwriting: lo que se estima cobrar. Sobrevive a la renta real para poder compararlas.';


--
-- Name: COLUMN properties.rent_monthly_actual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.properties.rent_monthly_actual IS 'Renta mensual efectivamente cobrada. Se captura al entrar a en_renta y nunca se prellena con la estimada.';


--
-- Name: properties_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.properties_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: properties_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.properties_id_seq OWNED BY public.properties.id;


--
-- Name: property_id_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_id_map (
    source text NOT NULL,
    old_id bigint NOT NULL,
    new_id bigint NOT NULL,
    CONSTRAINT property_id_map_source_check CHECK ((source = ANY (ARRAY['prospect'::text, 'project'::text])))
);


--
-- Name: property_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_images (
    id bigint NOT NULL,
    property_id bigint NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    image_type text DEFAULT 'antes'::text NOT NULL,
    legacy_source text,
    legacy_image_id bigint,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_images_file_path_check CHECK ((file_path <> ''::text)),
    CONSTRAINT property_images_image_type_check CHECK ((image_type = ANY (ARRAY['antes'::text, 'despues'::text]))),
    CONSTRAINT property_images_legacy_source_check CHECK ((legacy_source = ANY (ARRAY['prospect_images'::text, 'project_images'::text])))
);


--
-- Name: property_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.property_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: property_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.property_images_id_seq OWNED BY public.property_images.id;


--
-- Name: property_investors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_investors (
    id bigint NOT NULL,
    property_id bigint NOT NULL,
    investor_id bigint NOT NULL,
    status text DEFAULT 'interesado'::text NOT NULL,
    interested_amount numeric(14,2) DEFAULT 0 NOT NULL,
    committed_amount numeric(14,2) DEFAULT 0 NOT NULL,
    funded_amount numeric(14,2) DEFAULT 0 NOT NULL,
    interest_rate_annual real DEFAULT 0.12 NOT NULL,
    investment_date date,
    return_amount numeric(14,2),
    return_date date,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_investors_status_check CHECK ((status = ANY (ARRAY['interesado'::text, 'comprometido'::text, 'fondeado'::text])))
);


--
-- Name: property_investors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.property_investors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: property_investors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.property_investors_id_seq OWNED BY public.property_investors.id;


--
-- Name: property_renders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_renders (
    id bigint NOT NULL,
    property_id bigint NOT NULL,
    source_image_id bigint,
    file_path text NOT NULL,
    content_type text NOT NULL,
    prompt_id bigint,
    prompt_text text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source_plan_path text,
    parent_render_id bigint,
    source_variant text,
    floor_id text,
    floor_name text,
    is_chosen boolean DEFAULT false NOT NULL,
    CONSTRAINT property_renders_file_path_check CHECK ((file_path <> ''::text)),
    CONSTRAINT property_renders_prompt_text_check CHECK ((prompt_text <> ''::text)),
    CONSTRAINT property_renders_source_variant_check CHECK ((source_variant = ANY (ARRAY['original'::text, 'planned'::text])))
);


--
-- Name: property_renders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.property_renders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: property_renders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.property_renders_id_seq OWNED BY public.property_renders.id;


--
-- Name: property_status_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.property_status_events (
    id bigint NOT NULL,
    property_id bigint NOT NULL,
    from_status text,
    to_status text NOT NULL,
    effective_on date DEFAULT CURRENT_DATE NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_by bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT property_status_events_from_status_check CHECK ((from_status = ANY (ARRAY['prospecto'::text, 'oferta'::text, 'desarrollo'::text, 'en_renta'::text, 'vendida'::text, 'archivada'::text]))),
    CONSTRAINT property_status_events_moves CHECK ((from_status IS DISTINCT FROM to_status)),
    CONSTRAINT property_status_events_to_status_check CHECK ((to_status = ANY (ARRAY['prospecto'::text, 'oferta'::text, 'desarrollo'::text, 'en_renta'::text, 'vendida'::text, 'archivada'::text])))
);


--
-- Name: property_status_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.property_status_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: property_status_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.property_status_events_id_seq OWNED BY public.property_status_events.id;


--
-- Name: prospect_images_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_images_legacy (
    id bigint NOT NULL,
    prospect_id bigint NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prospect_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospect_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospect_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospect_images_id_seq OWNED BY public.prospect_images_legacy.id;


--
-- Name: prospects_legacy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospects_legacy (
    id bigint NOT NULL,
    name text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    status text NOT NULL,
    type text DEFAULT ''::text NOT NULL,
    url text NOT NULL,
    latitude real NOT NULL,
    longitude real NOT NULL,
    sqm_land real NOT NULL,
    sqm_construction real NOT NULL,
    land_price numeric(14,2) NOT NULL,
    acquisition_cost_pct real NOT NULL,
    permits_cost numeric(14,2) NOT NULL,
    subdivision_cost numeric(14,2) NOT NULL,
    construction_cost_per_sqm numeric(14,2) NOT NULL,
    construction_overhead real NOT NULL,
    projected_sale numeric(14,2) NOT NULL,
    hold_months integer DEFAULT 12 NOT NULL,
    rent_monthly numeric(14,2) NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    is_favorite boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    geometry jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT prospects_address_check CHECK ((address <> ''::text)),
    CONSTRAINT prospects_city_check CHECK ((city <> ''::text)),
    CONSTRAINT prospects_name_check CHECK ((name <> ''::text)),
    CONSTRAINT prospects_rent_monthly_check CHECK (((rent_monthly)::double precision >= (0)::double precision)),
    CONSTRAINT prospects_status_check CHECK ((status <> ''::text)),
    CONSTRAINT prospects_url_check CHECK ((url <> ''::text))
);


--
-- Name: prospects_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prospects_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: prospects_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.prospects_id_seq OWNED BY public.prospects_legacy.id;


--
-- Name: proveedor_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedor_categories (
    id bigint NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT proveedor_categories_name_check CHECK ((name <> ''::text))
);


--
-- Name: proveedor_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proveedor_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proveedor_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proveedor_categories_id_seq OWNED BY public.proveedor_categories.id;


--
-- Name: proveedor_category_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedor_category_links (
    proveedor_id bigint NOT NULL,
    category_id bigint NOT NULL
);


--
-- Name: proveedor_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedor_photos (
    id bigint NOT NULL,
    proveedor_id bigint NOT NULL,
    file_path text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proveedor_photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proveedor_photos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proveedor_photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proveedor_photos_id_seq OWNED BY public.proveedor_photos.id;


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proveedores (
    id bigint NOT NULL,
    name text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    website text DEFAULT ''::text NOT NULL,
    zona text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'activo'::text NOT NULL,
    veto_reason text,
    rating_calidad smallint,
    rating_puntualidad smallint,
    rating_precio smallint,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT proveedores_check CHECK (((status <> 'vetado'::text) OR (veto_reason IS NOT NULL))),
    CONSTRAINT proveedores_name_check CHECK ((name <> ''::text)),
    CONSTRAINT proveedores_rating_calidad_check CHECK (((rating_calidad >= 1) AND (rating_calidad <= 5))),
    CONSTRAINT proveedores_rating_precio_check CHECK (((rating_precio >= 1) AND (rating_precio <= 5))),
    CONSTRAINT proveedores_rating_puntualidad_check CHECK (((rating_puntualidad >= 1) AND (rating_puntualidad <= 5))),
    CONSTRAINT proveedores_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'inactivo'::text, 'vetado'::text])))
);


--
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.proveedores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.proveedores_id_seq OWNED BY public.proveedores.id;


--
-- Name: render_prompts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.render_prompts (
    id bigint NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    kind text DEFAULT 'photo'::text NOT NULL,
    CONSTRAINT render_prompts_body_check CHECK ((body <> ''::text)),
    CONSTRAINT render_prompts_kind_check CHECK ((kind = ANY (ARRAY['photo'::text, 'plan'::text]))),
    CONSTRAINT render_prompts_name_check CHECK ((name <> ''::text))
);


--
-- Name: render_prompts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.render_prompts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: render_prompts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.render_prompts_id_seq OWNED BY public.render_prompts.id;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signals (
    id bigint NOT NULL,
    portal text NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    city text DEFAULT 'Monterrey'::text NOT NULL,
    price numeric(14,2) DEFAULT 0 NOT NULL,
    sqm_land real DEFAULT 0 NOT NULL,
    raw_data text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    property_id bigint
);


--
-- Name: signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.signals_id_seq OWNED BY public.signals.id;


--
-- Name: sonar_scan_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sonar_scan_signals (
    scan_id bigint NOT NULL,
    signal_id bigint NOT NULL,
    price_at_scan numeric(14,2)
);


--
-- Name: sonar_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sonar_scans (
    id bigint NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cves text[],
    found integer,
    skipped integer,
    enriched integer
);


--
-- Name: sonar_scans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sonar_scans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sonar_scans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sonar_scans_id_seq OWNED BY public.sonar_scans.id;


--
-- Name: sonar_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sonar_signals (
    id bigint NOT NULL,
    url text NOT NULL,
    portal text NOT NULL,
    title text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    municipio_cve text DEFAULT ''::text NOT NULL,
    municipio_name text DEFAULT ''::text NOT NULL,
    colonia text DEFAULT ''::text NOT NULL,
    state_name text DEFAULT ''::text NOT NULL,
    lat double precision,
    lon double precision,
    price numeric(14,2) DEFAULT 0 NOT NULL,
    sqm_land double precision DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_price numeric(14,2)
);


--
-- Name: sonar_signals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sonar_signals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sonar_signals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sonar_signals_id_seq OWNED BY public.sonar_signals.id;


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    id bigint NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    manager_id bigint,
    email text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT team_members_name_check CHECK ((name <> ''::text)),
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['director'::text, 'responsable_proyecto'::text, 'lider_proyecto'::text, 'maestro'::text, 'ayudante'::text, 'finder'::text])))
);


--
-- Name: team_members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_members_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_members_id_seq OWNED BY public.team_members.id;


--
-- Name: template_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_nodes (
    id bigint NOT NULL,
    template_id bigint NOT NULL,
    parent_id bigint,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    depends_on_id bigint,
    source_template_id bigint,
    duration_days integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    supplier_category_id bigint,
    CONSTRAINT template_nodes_name_check CHECK ((name <> ''::text))
);


--
-- Name: template_nodes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.template_nodes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: template_nodes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.template_nodes_id_seq OWNED BY public.template_nodes.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    email text NOT NULL,
    hashed_password text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
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
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id bigint NOT NULL,
    name text NOT NULL,
    cities jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT zones_name_check CHECK ((name <> ''::text))
);


--
-- Name: zones_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.zones_id_seq OWNED BY public.zones.id;


--
-- Name: api_keys id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys ALTER COLUMN id SET DEFAULT nextval('public.api_keys_id_seq'::regclass);


--
-- Name: budget_line_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_line_payments ALTER COLUMN id SET DEFAULT nextval('public.budget_line_payments_id_seq'::regclass);


--
-- Name: budget_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines ALTER COLUMN id SET DEFAULT nextval('public.budget_lines_id_seq'::regclass);


--
-- Name: budgets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets ALTER COLUMN id SET DEFAULT nextval('public.budgets_id_seq'::regclass);


--
-- Name: comparable_check_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparable_check_log ALTER COLUMN id SET DEFAULT nextval('public.comparable_check_log_id_seq'::regclass);


--
-- Name: comparables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparables ALTER COLUMN id SET DEFAULT nextval('public.comparables_id_seq'::regclass);


--
-- Name: cotizaciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones ALTER COLUMN id SET DEFAULT nextval('public.cotizaciones_id_seq'::regclass);


--
-- Name: instance_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_files ALTER COLUMN id SET DEFAULT nextval('public.instance_files_id_seq'::regclass);


--
-- Name: instance_node_states id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states ALTER COLUMN id SET DEFAULT nextval('public.instance_node_states_id_seq'::regclass);


--
-- Name: investors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investors ALTER COLUMN id SET DEFAULT nextval('public.investors_id_seq'::regclass);


--
-- Name: node_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_comments ALTER COLUMN id SET DEFAULT nextval('public.node_comments_id_seq'::regclass);


--
-- Name: node_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_files ALTER COLUMN id SET DEFAULT nextval('public.node_files_id_seq'::regclass);


--
-- Name: process_instances id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances ALTER COLUMN id SET DEFAULT nextval('public.process_instances_id_seq'::regclass);


--
-- Name: process_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_templates ALTER COLUMN id SET DEFAULT nextval('public.process_templates_id_seq'::regclass);


--
-- Name: profit_split_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config ALTER COLUMN id SET DEFAULT nextval('public.profit_split_config_id_seq'::regclass);


--
-- Name: project_images_legacy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_images_legacy ALTER COLUMN id SET DEFAULT nextval('public.project_images_id_seq'::regclass);


--
-- Name: projects_legacy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects_legacy ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);


--
-- Name: properties id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties ALTER COLUMN id SET DEFAULT nextval('public.properties_id_seq'::regclass);


--
-- Name: property_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_images ALTER COLUMN id SET DEFAULT nextval('public.property_images_id_seq'::regclass);


--
-- Name: property_investors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_investors ALTER COLUMN id SET DEFAULT nextval('public.property_investors_id_seq'::regclass);


--
-- Name: property_renders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders ALTER COLUMN id SET DEFAULT nextval('public.property_renders_id_seq'::regclass);


--
-- Name: property_status_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_status_events ALTER COLUMN id SET DEFAULT nextval('public.property_status_events_id_seq'::regclass);


--
-- Name: prospect_images_legacy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_images_legacy ALTER COLUMN id SET DEFAULT nextval('public.prospect_images_id_seq'::regclass);


--
-- Name: prospects_legacy id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects_legacy ALTER COLUMN id SET DEFAULT nextval('public.prospects_id_seq'::regclass);


--
-- Name: proveedor_categories id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_categories ALTER COLUMN id SET DEFAULT nextval('public.proveedor_categories_id_seq'::regclass);


--
-- Name: proveedor_photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_photos ALTER COLUMN id SET DEFAULT nextval('public.proveedor_photos_id_seq'::regclass);


--
-- Name: proveedores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id SET DEFAULT nextval('public.proveedores_id_seq'::regclass);


--
-- Name: render_prompts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.render_prompts ALTER COLUMN id SET DEFAULT nextval('public.render_prompts_id_seq'::regclass);


--
-- Name: signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals ALTER COLUMN id SET DEFAULT nextval('public.signals_id_seq'::regclass);


--
-- Name: sonar_scans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_scans ALTER COLUMN id SET DEFAULT nextval('public.sonar_scans_id_seq'::regclass);


--
-- Name: sonar_signals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_signals ALTER COLUMN id SET DEFAULT nextval('public.sonar_signals_id_seq'::regclass);


--
-- Name: team_members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members ALTER COLUMN id SET DEFAULT nextval('public.team_members_id_seq'::regclass);


--
-- Name: template_nodes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes ALTER COLUMN id SET DEFAULT nextval('public.template_nodes_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: zones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones ALTER COLUMN id SET DEFAULT nextval('public.zones_id_seq'::regclass);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: budget_line_payments budget_line_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_line_payments
    ADD CONSTRAINT budget_line_payments_pkey PRIMARY KEY (id);


--
-- Name: budget_lines budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_pkey PRIMARY KEY (id);


--
-- Name: budgets budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_pkey PRIMARY KEY (id);


--
-- Name: comparable_check_log comparable_check_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparable_check_log
    ADD CONSTRAINT comparable_check_log_pkey PRIMARY KEY (id);


--
-- Name: comparables comparables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparables
    ADD CONSTRAINT comparables_pkey PRIMARY KEY (id);


--
-- Name: cotizaciones cotizaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_pkey PRIMARY KEY (id);


--
-- Name: instance_files instance_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_files
    ADD CONSTRAINT instance_files_pkey PRIMARY KEY (id);


--
-- Name: instance_node_states instance_node_states_instance_id_template_node_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_instance_id_template_node_id_key UNIQUE (instance_id, template_node_id);


--
-- Name: instance_node_states instance_node_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_pkey PRIMARY KEY (id);


--
-- Name: investors investors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_pkey PRIMARY KEY (id);


--
-- Name: node_comments node_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_comments
    ADD CONSTRAINT node_comments_pkey PRIMARY KEY (id);


--
-- Name: node_files node_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_files
    ADD CONSTRAINT node_files_pkey PRIMARY KEY (id);


--
-- Name: process_instances process_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_pkey PRIMARY KEY (id);


--
-- Name: process_templates process_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_templates
    ADD CONSTRAINT process_templates_pkey PRIMARY KEY (id);


--
-- Name: profit_split_config profit_split_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config
    ADD CONSTRAINT profit_split_config_pkey PRIMARY KEY (id);


--
-- Name: project_images_legacy project_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_images_legacy
    ADD CONSTRAINT project_images_pkey PRIMARY KEY (id);


--
-- Name: projects_legacy projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects_legacy
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: properties properties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.properties
    ADD CONSTRAINT properties_pkey PRIMARY KEY (id);


--
-- Name: property_id_map property_id_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_id_map
    ADD CONSTRAINT property_id_map_pkey PRIMARY KEY (source, old_id);


--
-- Name: property_images property_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_images
    ADD CONSTRAINT property_images_pkey PRIMARY KEY (id);


--
-- Name: property_images property_images_unique_path; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_images
    ADD CONSTRAINT property_images_unique_path UNIQUE (property_id, file_path);


--
-- Name: property_investors property_investors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_investors
    ADD CONSTRAINT property_investors_pkey PRIMARY KEY (id);


--
-- Name: property_renders property_renders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_pkey PRIMARY KEY (id);


--
-- Name: property_renders property_renders_unique_path; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_unique_path UNIQUE (property_id, file_path);


--
-- Name: property_status_events property_status_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_status_events
    ADD CONSTRAINT property_status_events_pkey PRIMARY KEY (id);


--
-- Name: prospect_images_legacy prospect_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_images_legacy
    ADD CONSTRAINT prospect_images_pkey PRIMARY KEY (id);


--
-- Name: prospects_legacy prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects_legacy
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: proveedor_categories proveedor_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_categories
    ADD CONSTRAINT proveedor_categories_pkey PRIMARY KEY (id);


--
-- Name: proveedor_category_links proveedor_category_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_category_links
    ADD CONSTRAINT proveedor_category_links_pkey PRIMARY KEY (proveedor_id, category_id);


--
-- Name: proveedor_photos proveedor_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_photos
    ADD CONSTRAINT proveedor_photos_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: render_prompts render_prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.render_prompts
    ADD CONSTRAINT render_prompts_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: signals signals_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_url_key UNIQUE (url);


--
-- Name: sonar_scan_signals sonar_scan_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_scan_signals
    ADD CONSTRAINT sonar_scan_signals_pkey PRIMARY KEY (scan_id, signal_id);


--
-- Name: sonar_scans sonar_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_scans
    ADD CONSTRAINT sonar_scans_pkey PRIMARY KEY (id);


--
-- Name: sonar_signals sonar_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_signals
    ADD CONSTRAINT sonar_signals_pkey PRIMARY KEY (id);


--
-- Name: sonar_signals sonar_signals_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_signals
    ADD CONSTRAINT sonar_signals_url_key UNIQUE (url);


--
-- Name: team_members team_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_pkey PRIMARY KEY (id);


--
-- Name: template_nodes template_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_pkey PRIMARY KEY (id);


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
-- Name: zones zones_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_name_key UNIQUE (name);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: api_keys_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_key_hash ON public.api_keys USING btree (key_hash);


--
-- Name: api_keys_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX api_keys_user_id ON public.api_keys USING btree (user_id);


--
-- Name: idx_budget_line_payments_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_line_payments_line ON public.budget_line_payments USING btree (line_id, paid_on);


--
-- Name: idx_budget_lines_budget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_lines_budget ON public.budget_lines USING btree (budget_id, sort_order);


--
-- Name: idx_budget_lines_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_lines_name_trgm ON public.budget_lines USING gin (name public.gin_trgm_ops);


--
-- Name: idx_budget_lines_supplier_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_budget_lines_supplier_category ON public.budget_lines USING btree (supplier_category_id) WHERE (supplier_category_id IS NOT NULL);


--
-- Name: idx_check_log_comparable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_log_comparable ON public.comparable_check_log USING btree (comparable_id, checked_at DESC);


--
-- Name: idx_comments_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_node ON public.node_comments USING btree (template_node_id, instance_id);


--
-- Name: idx_comparables_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparables_geo ON public.comparables USING btree (lat, lng);


--
-- Name: idx_comparables_last_seen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparables_last_seen ON public.comparables USING btree (last_seen_active);


--
-- Name: idx_comparables_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparables_status ON public.comparables USING btree (status);


--
-- Name: idx_comparables_type_condition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparables_type_condition ON public.comparables USING btree (property_type, condition);


--
-- Name: idx_comparables_zone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comparables_zone ON public.comparables USING btree (zone_id);


--
-- Name: idx_cotizaciones_node_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_node_state ON public.cotizaciones USING btree (instance_node_state_id);


--
-- Name: idx_cotizaciones_proveedor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cotizaciones_proveedor ON public.cotizaciones USING btree (proveedor_id);


--
-- Name: idx_ins_node_state_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ins_node_state_supplier ON public.instance_node_states USING btree (supplier_id);


--
-- Name: idx_instance_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instance_owner ON public.process_instances USING btree (owner_id);


--
-- Name: idx_instance_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instance_property ON public.process_instances USING btree (property_id);


--
-- Name: idx_instance_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instance_template ON public.process_instances USING btree (template_id);


--
-- Name: idx_instances_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instances_origin ON public.process_instances USING btree (origin_instance_id);


--
-- Name: idx_instances_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instances_status ON public.process_instances USING btree (status);


--
-- Name: idx_node_depends; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_depends ON public.template_nodes USING btree (depends_on_id);


--
-- Name: idx_node_files_instance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_files_instance ON public.node_files USING btree (instance_id);


--
-- Name: idx_node_files_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_files_node ON public.node_files USING btree (template_node_id);


--
-- Name: idx_node_state_inst; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_state_inst ON public.instance_node_states USING btree (instance_id);


--
-- Name: idx_node_state_node; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_state_node ON public.instance_node_states USING btree (template_node_id);


--
-- Name: idx_node_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_node_template ON public.template_nodes USING btree (template_id);


--
-- Name: idx_pi_investor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_investor ON public.property_investors USING btree (investor_id);


--
-- Name: idx_pi_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pi_property ON public.property_investors USING btree (property_id);


--
-- Name: idx_projects_acq_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_acq_date ON public.projects_legacy USING btree (acquisition_date DESC);


--
-- Name: idx_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_status ON public.projects_legacy USING btree (status);


--
-- Name: idx_properties_acquisition_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_properties_acquisition_date ON public.properties USING btree (acquisition_date DESC NULLS LAST);


--
-- Name: idx_properties_city_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_properties_city_status ON public.properties USING btree (city, status);


--
-- Name: idx_properties_favorite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_properties_favorite ON public.properties USING btree (id) WHERE is_favorite;


--
-- Name: idx_properties_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_properties_status ON public.properties USING btree (status);


--
-- Name: idx_property_events_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_events_property ON public.property_status_events USING btree (property_id, effective_on DESC);


--
-- Name: idx_property_events_to_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_events_to_status ON public.property_status_events USING btree (to_status, effective_on DESC);


--
-- Name: idx_property_id_map_new; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_id_map_new ON public.property_id_map USING btree (new_id);


--
-- Name: idx_property_images_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_images_property ON public.property_images USING btree (property_id, sort_order);


--
-- Name: idx_property_renders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_renders_parent ON public.property_renders USING btree (parent_render_id);


--
-- Name: idx_property_renders_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_property_renders_property ON public.property_renders USING btree (property_id, created_at DESC);


--
-- Name: idx_prov_cat_links_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prov_cat_links_cat ON public.proveedor_category_links USING btree (category_id);


--
-- Name: idx_proveedor_photos_prov; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proveedor_photos_prov ON public.proveedor_photos USING btree (proveedor_id);


--
-- Name: idx_render_chosen_per_floor; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_render_chosen_per_floor ON public.property_renders USING btree (property_id, floor_id, source_variant) WHERE (is_chosen AND (floor_id IS NOT NULL));


--
-- Name: idx_render_chosen_per_photo; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_render_chosen_per_photo ON public.property_renders USING btree (property_id, source_image_id) WHERE (is_chosen AND (source_image_id IS NOT NULL));


--
-- Name: idx_render_prompts_name_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_render_prompts_name_active ON public.render_prompts USING btree (lower(name)) WHERE (archived_at IS NULL);


--
-- Name: idx_signals_property; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_property ON public.signals USING btree (property_id);


--
-- Name: idx_signals_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_status ON public.signals USING btree (status);


--
-- Name: idx_sonar_scan_signals; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sonar_scan_signals ON public.sonar_scan_signals USING btree (scan_id);


--
-- Name: idx_sonar_signals_colonia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sonar_signals_colonia ON public.sonar_signals USING btree (colonia);


--
-- Name: idx_sonar_signals_cve; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sonar_signals_cve ON public.sonar_signals USING btree (municipio_cve);


--
-- Name: idx_sonar_signals_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sonar_signals_state ON public.sonar_signals USING btree (state_name);


--
-- Name: idx_team_manager; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_manager ON public.team_members USING btree (manager_id);


--
-- Name: idx_template_nodes_supplier_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_nodes_supplier_cat ON public.template_nodes USING btree (supplier_category_id);


--
-- Name: uq_budget_lines_residual; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_budget_lines_residual ON public.budget_lines USING btree (budget_id) WHERE is_residual;


--
-- Name: uq_budgets_property; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_budgets_property ON public.budgets USING btree (property_id);


--
-- Name: uq_comparables_listing_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_comparables_listing_url ON public.comparables USING btree (listing_url);


--
-- Name: uq_profit_split_property; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_profit_split_property ON public.profit_split_config USING btree (property_id) WHERE (property_id IS NOT NULL);


--
-- Name: budget_lines trg_budget_lines_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_budget_lines_touch BEFORE UPDATE ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: budgets trg_budgets_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_budgets_touch BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: properties trg_properties_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_properties_touch BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.properties_touch_updated_at();


--
-- Name: properties trg_properties_transition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_properties_transition BEFORE UPDATE OF status ON public.properties FOR EACH ROW WHEN ((old.status IS DISTINCT FROM new.status)) EXECUTE FUNCTION public.properties_guard_transition();


--
-- Name: api_keys api_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: budget_line_payments budget_line_payments_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_line_payments
    ADD CONSTRAINT budget_line_payments_line_id_fkey FOREIGN KEY (line_id) REFERENCES public.budget_lines(id) ON DELETE CASCADE;


--
-- Name: budget_lines budget_lines_budget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.budgets(id) ON DELETE CASCADE;


--
-- Name: budget_lines budget_lines_supplier_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_supplier_category_id_fkey FOREIGN KEY (supplier_category_id) REFERENCES public.proveedor_categories(id) ON DELETE SET NULL;


--
-- Name: budget_lines budget_lines_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budget_lines
    ADD CONSTRAINT budget_lines_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- Name: budgets budgets_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.budgets
    ADD CONSTRAINT budgets_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: comparables comparables_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comparables
    ADD CONSTRAINT comparables_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: cotizaciones cotizaciones_instance_node_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_instance_node_state_id_fkey FOREIGN KEY (instance_node_state_id) REFERENCES public.instance_node_states(id) ON DELETE CASCADE;


--
-- Name: cotizaciones cotizaciones_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cotizaciones
    ADD CONSTRAINT cotizaciones_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- Name: instance_files instance_files_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_files
    ADD CONSTRAINT instance_files_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.process_instances(id) ON DELETE CASCADE;


--
-- Name: instance_node_states instance_node_states_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: instance_node_states instance_node_states_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.process_instances(id) ON DELETE CASCADE;


--
-- Name: instance_node_states instance_node_states_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.proveedores(id) ON DELETE SET NULL;


--
-- Name: instance_node_states instance_node_states_template_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instance_node_states
    ADD CONSTRAINT instance_node_states_template_node_id_fkey FOREIGN KEY (template_node_id) REFERENCES public.template_nodes(id) ON DELETE CASCADE;


--
-- Name: node_comments node_comments_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_comments
    ADD CONSTRAINT node_comments_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.process_instances(id) ON DELETE CASCADE;


--
-- Name: node_comments node_comments_template_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_comments
    ADD CONSTRAINT node_comments_template_node_id_fkey FOREIGN KEY (template_node_id) REFERENCES public.template_nodes(id) ON DELETE CASCADE;


--
-- Name: node_files node_files_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_files
    ADD CONSTRAINT node_files_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES public.process_instances(id) ON DELETE CASCADE;


--
-- Name: node_files node_files_template_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.node_files
    ADD CONSTRAINT node_files_template_node_id_fkey FOREIGN KEY (template_node_id) REFERENCES public.template_nodes(id) ON DELETE CASCADE;


--
-- Name: process_instances process_instances_origin_instance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_origin_instance_id_fkey FOREIGN KEY (origin_instance_id) REFERENCES public.process_instances(id);


--
-- Name: process_instances process_instances_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: process_instances process_instances_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: process_instances process_instances_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_instances
    ADD CONSTRAINT process_instances_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.process_templates(id) ON DELETE CASCADE;


--
-- Name: profit_split_config profit_split_config_finder_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config
    ADD CONSTRAINT profit_split_config_finder_member_id_fkey FOREIGN KEY (finder_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: profit_split_config profit_split_config_lider_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config
    ADD CONSTRAINT profit_split_config_lider_member_id_fkey FOREIGN KEY (lider_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: profit_split_config profit_split_config_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config
    ADD CONSTRAINT profit_split_config_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: profit_split_config profit_split_config_responsable_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profit_split_config
    ADD CONSTRAINT profit_split_config_responsable_member_id_fkey FOREIGN KEY (responsable_member_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: project_images_legacy project_images_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_images_legacy
    ADD CONSTRAINT project_images_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects_legacy(id) ON DELETE CASCADE;


--
-- Name: projects_legacy projects_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects_legacy
    ADD CONSTRAINT projects_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects_legacy(id) ON DELETE SET NULL;


--
-- Name: property_id_map property_id_map_new_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_id_map
    ADD CONSTRAINT property_id_map_new_id_fkey FOREIGN KEY (new_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: property_images property_images_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_images
    ADD CONSTRAINT property_images_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: property_investors property_investors_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_investors
    ADD CONSTRAINT property_investors_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id) ON DELETE CASCADE;


--
-- Name: property_investors property_investors_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_investors
    ADD CONSTRAINT property_investors_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: property_renders property_renders_parent_render_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_parent_render_id_fkey FOREIGN KEY (parent_render_id) REFERENCES public.property_renders(id) ON DELETE SET NULL;


--
-- Name: property_renders property_renders_prompt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.render_prompts(id) ON DELETE SET NULL;


--
-- Name: property_renders property_renders_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: property_renders property_renders_source_image_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_renders
    ADD CONSTRAINT property_renders_source_image_id_fkey FOREIGN KEY (source_image_id) REFERENCES public.property_images(id) ON DELETE SET NULL;


--
-- Name: property_status_events property_status_events_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_status_events
    ADD CONSTRAINT property_status_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: property_status_events property_status_events_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.property_status_events
    ADD CONSTRAINT property_status_events_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;


--
-- Name: prospect_images_legacy prospect_images_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_images_legacy
    ADD CONSTRAINT prospect_images_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects_legacy(id) ON DELETE CASCADE;


--
-- Name: proveedor_category_links proveedor_category_links_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_category_links
    ADD CONSTRAINT proveedor_category_links_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.proveedor_categories(id) ON DELETE CASCADE;


--
-- Name: proveedor_category_links proveedor_category_links_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_category_links
    ADD CONSTRAINT proveedor_category_links_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;


--
-- Name: proveedor_photos proveedor_photos_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proveedor_photos
    ADD CONSTRAINT proveedor_photos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id) ON DELETE CASCADE;


--
-- Name: signals signals_property_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_property_id_fkey FOREIGN KEY (property_id) REFERENCES public.properties(id);


--
-- Name: sonar_scan_signals sonar_scan_signals_scan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_scan_signals
    ADD CONSTRAINT sonar_scan_signals_scan_id_fkey FOREIGN KEY (scan_id) REFERENCES public.sonar_scans(id);


--
-- Name: sonar_scan_signals sonar_scan_signals_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sonar_scan_signals
    ADD CONSTRAINT sonar_scan_signals_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.sonar_signals(id);


--
-- Name: team_members team_members_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_members
    ADD CONSTRAINT team_members_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.team_members(id) ON DELETE SET NULL;


--
-- Name: template_nodes template_nodes_depends_on_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_depends_on_id_fkey FOREIGN KEY (depends_on_id) REFERENCES public.template_nodes(id) ON DELETE SET NULL;


--
-- Name: template_nodes template_nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.template_nodes(id) ON DELETE CASCADE;


--
-- Name: template_nodes template_nodes_source_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_source_template_id_fkey FOREIGN KEY (source_template_id) REFERENCES public.process_templates(id);


--
-- Name: template_nodes template_nodes_supplier_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_supplier_category_id_fkey FOREIGN KEY (supplier_category_id) REFERENCES public.proveedor_categories(id) ON DELETE SET NULL;


--
-- Name: template_nodes template_nodes_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_nodes
    ADD CONSTRAINT template_nodes_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.process_templates(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('000'),
    ('001'),
    ('002'),
    ('003'),
    ('004'),
    ('005'),
    ('006'),
    ('007'),
    ('008'),
    ('009'),
    ('010'),
    ('011'),
    ('012'),
    ('013'),
    ('014'),
    ('015'),
    ('016'),
    ('017'),
    ('018'),
    ('019'),
    ('020'),
    ('021'),
    ('022'),
    ('023'),
    ('024'),
    ('025'),
    ('026'),
    ('027'),
    ('028'),
    ('032'),
    ('033'),
    ('034'),
    ('035'),
    ('036'),
    ('037'),
    ('038'),
    ('039'),
    ('040'),
    ('041'),
    ('042'),
    ('043'),
    ('044'),
    ('045'),
    ('046');
